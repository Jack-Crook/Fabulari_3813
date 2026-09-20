// one off script: loads the phase 1 json files into mongo so there's data to work with.
// run it with `npm run seed`. it clears the six collections first, so it's safe to re-run and
// always produces the same starting state rather than duplicating everything.
//
// the json files use hand written string ids (g1, c1, r17885...) and channels and requests
// point at their group with that same string. mongo generates its own _id, so this loads the
// groups first, remembers which new _id each old string id became, and rewrites every
// reference through that map. without it the rooms and requests would all point at ids that
// no longer exist.

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const bcrypt = require('bcrypt');       // the json files hold plain passwords, they get hashed on the way in

const SALT_ROUNDS = 10;     // the same cost server.js registers with, so a seeded account is no different to a registered one

const MONGO_URL = process.env.MONGO_URL ?? 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME ?? 'fabulari';

function readJson(name) {
  const file = path.join(__dirname, 'data', name);
  if (!fs.existsSync(file)) {
    return [];
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function seed() {
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  const db = client.db(DB_NAME);

  const names = ['users', 'groups', 'channels', 'requests', 'audit', 'banned'];
  for (const name of names) {
    await db.collection(name).deleteMany({});
  }

  // users carry no id of their own, email is the identifier, so nothing has to be rewritten.
  // the password does though: data/users.json is a fixture written by hand, so the passwords in
  // it are readable, and the database only ever holds the hash. hashing here rather than
  // rewriting the file keeps the fixture usable, since the point of it is knowing the logins.
  const users = readJson('users.json');
  if (users.length) {
    const hashed = await Promise.all(users.map(async user => ({
      ...user,
      password: await bcrypt.hash(user.password, SALT_ROUNDS),
    })));
    await db.collection('users').insertMany(hashed);
  }

  // strip the old string id off each group and keep a map from it to the _id mongo assigns
  const oldToNew = new Map();
  const groups = readJson('groups.json');
  for (const group of groups) {
    const { id, ...rest } = group;
    rest.bannedEmails = rest.bannedEmails ?? [];   // older records predate this field
    const result = await db.collection('groups').insertOne(rest);
    oldToNew.set(id, result.insertedId);
  }

  // channels are rewritten to point at the new group _id. one whose group is missing would be
  // an orphan room, so it's skipped rather than inserted broken.
  const channels = readJson('channels.json');
  let skippedChannels = 0;
  for (const channel of channels) {
    const groupId = oldToNew.get(channel.groupId);
    if (!groupId) {
      skippedChannels++;
      continue;
    }
    await db.collection('channels').insertOne({ groupId, name: channel.name });
  }

  // requests point at a group the same way, except group-create ones, which have no group yet
  // and stored that as an empty string. those become null, which is what server.js writes now.
  const requests = readJson('requests.json');
  let skippedRequests = 0;
  for (const request of requests) {
    const { id, groupId, ...rest } = request;
    if (groupId && !oldToNew.has(groupId)) {
      skippedRequests++;      // the group it referred to isn't in groups.json any more
      continue;
    }
    await db.collection('requests').insertOne({ ...rest, groupId: groupId ? oldToNew.get(groupId) : null });
  }

  // audit entries and bans reference people by email, not by group id, so they need no rewriting
  const auditEntries = readJson('audit.json').map(({ id, ...rest }) => rest);
  if (auditEntries.length) {
    await db.collection('audit').insertMany(auditEntries);
  }

  const bans = readJson('banned.json');
  if (bans.length) {
    await db.collection('banned').insertMany(bans);
  }

  // email is the unique identifier for an account, and a banned email can never be reused, so
  // both are worth mongo enforcing rather than trusting a route to always check first. group
  // names are unique per the spec, compared case insensitively, so that index carries the same
  // collation the queries in server.js use.
  await db.collection('users').createIndex({ email: 1 }, { unique: true });
  await db.collection('banned').createIndex({ email: 1 }, { unique: true });
  await db.collection('groups').createIndex({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
  // the queues and the audit page both read newest first, and both filter before sorting
  await db.collection('requests').createIndex({ status: 1, createdAt: -1 });
  await db.collection('audit').createIndex({ type: 1, at: -1 });

  // a group can only hold emails that belong to real accounts, which the endpoints enforce but
  // the json files predate. anything listed here would be an admin who can't log in.
  const emails = new Set(users.map(u => u.email));
  const orphans = new Set();
  for (const group of groups) {
    for (const email of [...group.adminEmails, ...group.memberEmails]) {
      if (!emails.has(email)) {
        orphans.add(email);
      }
    }
  }

  console.log(`Seeded ${users.length} users, ${groups.length} groups, `
    + `${channels.length - skippedChannels} channels, ${requests.length - skippedRequests} requests, `
    + `${auditEntries.length} audit entries, ${bans.length} bans.`);
  if (skippedChannels) {
    console.log(`Skipped ${skippedChannels} channel(s) whose group no longer exists.`);
  }
  if (skippedRequests) {
    console.log(`Skipped ${skippedRequests} request(s) whose group no longer exists.`);
  }
  if (orphans.size) {
    console.log(`Warning: these group members have no user account: ${[...orphans].join(', ')}`);
  }

  await client.close();
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
