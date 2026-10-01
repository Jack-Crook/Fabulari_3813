// loads the phase 1 json files into mongo (`npm run seed`). clears the collections first, so
// re-running always gives the same starting state.
//
// the json uses string ids (g1, c1...) and mongo makes its own _id, so groups are loaded first
// and a map from old id to new _id is used to rewrite the rooms' and requests' groupId.

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const bcrypt = require('bcrypt');       // the json has plain passwords, hashed on the way in

const SALT_ROUNDS = 10;     // same cost as server.js

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

  const names = ['users', 'groups', 'channels', 'requests', 'audit', 'banned', 'messages'];
  for (const name of names) {
    await db.collection(name).deleteMany({});
  }

  // messages are cleared, so their uploaded images are too
  const uploads = path.join(__dirname, 'uploads');
  fs.rmSync(uploads, { recursive: true, force: true });
  fs.mkdirSync(uploads, { recursive: true });

  // users need no id rewriting (email is the identifier), only their passwords hashed. the json
  // keeps plain passwords so the test logins are known.
  const users = readJson('users.json');
  if (users.length) {
    const hashed = await Promise.all(users.map(async user => ({
      ...user,
      password: await bcrypt.hash(user.password, SALT_ROUNDS),
      avatarUrl: user.avatarUrl ?? '',   // no pictures in the fixture
    })));
    await db.collection('users').insertMany(hashed);
  }

  // old string id -> new mongo _id
  const oldToNew = new Map();
  const groups = readJson('groups.json');
  for (const group of groups) {
    const { id, ...rest } = group;
    rest.bannedEmails = rest.bannedEmails ?? [];   // older records don't have it
    const result = await db.collection('groups').insertOne(rest);
    oldToNew.set(id, result.insertedId);
  }

  // point each room at its group's new _id. rooms with no group are skipped.
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

  // same for requests. group-create has no group yet, '' becomes null like server.js writes.
  const requests = readJson('requests.json');
  let skippedRequests = 0;
  for (const request of requests) {
    const { id, groupId, ...rest } = request;
    if (groupId && !oldToNew.has(groupId)) {
      skippedRequests++;      // its group no longer exists
      continue;
    }
    await db.collection('requests').insertOne({ ...rest, groupId: groupId ? oldToNew.get(groupId) : null });
  }

  // audit and bans use emails, nothing to rewrite
  const auditEntries = readJson('audit.json').map(({ id, ...rest }) => rest);
  if (auditEntries.length) {
    await db.collection('audit').insertMany(auditEntries);
  }

  const bans = readJson('banned.json');
  if (bans.length) {
    await db.collection('banned').insertMany(bans);
  }

  // unique emails and group names enforced by mongo itself. group names ignore case, with the
  // same collation server.js queries with.
  await db.collection('users').createIndex({ email: 1 }, { unique: true });
  await db.collection('banned').createIndex({ email: 1 }, { unique: true });
  await db.collection('groups').createIndex({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
  // the request queues and audit page filter, then sort newest first
  await db.collection('requests').createIndex({ status: 1, createdAt: -1 });
  await db.collection('audit').createIndex({ type: 1, at: -1 });

  // warn about group members in the json with no account
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
