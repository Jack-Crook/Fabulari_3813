const express = require('express');
const cors = require('cors');// Angular (localhost:4200) and Express (localhost:3000) are different origins,
                            // so without this the browser blocks Angular's requests to this API by default.
                    // cors() adds the Access-Control-Allow-Origin header to responses so the browser allows it.
const { MongoClient, ObjectId } = require('mongodb');   // MongoClient opens the connection, ObjectId turns an id from a url back into the type mongo stores

const app = express();

app.use(cors());            // allow requests from other origins (Angular on :4200)
app.use(express.json());    // parse JSON request bodies into req.body

app.get('/', (req, res) => {            // test route to confirm the server is alive
  res.send('Fabulari API running');
});


// phase 1 stored everything in json files under data/, one file per type. phase 2 replaces
// that with mongo, one collection per type, which is the shape the file split was already
// built around. data/*.json is still in the repo, but only as the seed for `npm run seed`.
const MONGO_URL = process.env.MONGO_URL ?? 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME ?? 'fabulari';

let users;      // assigned by start() below, before the server begins listening, so no route
let groups;     // can ever run against an undefined collection
let channels;
let requests;
let audit;
let banned;


// ids for groups, channels, requests and audit entries now come from mongo's own _id rather
// than the old makeId() timestamp. an id arriving from a url is a 24 character hex string that
// has to be turned back into an ObjectId before it can match anything. a malformed one makes
// the ObjectId constructor throw, so this returns null instead and the caller answers 404.
function toObjectId(value) {
    return ObjectId.isValid(value) ? new ObjectId(value) : null;
}

// the spec says email is the unique identifier for a user, so it gets trimmed and lowercased everywhere.
// without this Test@Test.com and test@test.com would be stored as two different people.
function normaliseEmail(email) {
    return String(email ?? '').trim().toLowerCase();
}

// good enough for a prototype: something, an @, something, a dot, something. real address
// validation is a rabbit hole, and the only thing this has to stop is obvious nonsense.
function looksLikeEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// group names are unique case insensitively, and so are channel names inside one group.
// phase 1 lowercased both sides in JS. mongo does the same comparison itself with a collation:
// strength 2 means it ignores case (and accents) when matching, and the unique index created
// in seed.js uses the same collation so the database enforces it too.
const CASE_INSENSITIVE = { collation: { locale: 'en', strength: 2 } };

// the password never leaves the server. every route that sends a user back sends this instead
// of the raw record, so the stored password can't be read out of an API response. _id is
// dropped as well, because email is what identifies a user everywhere in this app.
function publicUser(user) {
    return {
        email: user.email,
        role: user.role,
        username: user.username ?? '',
        dob: user.dob ?? '',
        bio: user.bio ?? '',
        createdAt: user.createdAt ?? '',
    };
}

// records written before bannedEmails existed come back without it, and .includes() on
// undefined throws. every group read goes through here so the gap is filled in one place.
function normaliseGroup(group) {
    if (group) {
        group.bannedEmails = group.bannedEmails ?? [];
    }
    return group;
}

// age in whole years from a yyyy-mm-dd date of birth, or null when there isn't one stored.
// null matters: it means "unknown", which is treated differently from "too young" below.
function ageFrom(dob) {
    if (!dob) {
        return null;
    }
    const born = new Date(dob);
    if (isNaN(born.getTime())) {      // a typed date that isn't a real date parses to NaN
        return null;
    }
    const now = new Date();
    let age = now.getFullYear() - born.getFullYear();
    const monthsIn = now.getMonth() - born.getMonth();
    if (monthsIn < 0 || (monthsIn === 0 && now.getDate() < born.getDate())) {
        age = age - 1;                  // their birthday hasn't happened yet this year
    }
    return age;
}

// the spec asks for an audit log the super admin can filter by type and read in date order,
// so every route that changes something calls this. it's one line at each call site, which is
// the only way a log like this stays complete. async now, because it writes to mongo.
async function logAudit(type, actor, detail) {
    await audit.insertOne({
        at: new Date().toISOString(),   // stored as ISO so string sorting and date sorting agree
        type,
        actor,
        detail,
    });
}

// used by the join route and by the age limit check when an admin raises it. returns a
// reason string when the user can't be in the group, or null when they're fine.
function ageProblem(user, group) {
    if (!group.ageLimit) {            // 0 (or missing) means the group has no age restriction
        return null;
    }
    const age = ageFrom(user.dob);
    if (age === null) {
        return 'This group has an age limit. Add your date of birth in your profile first.';
    }
    if (age < group.ageLimit) {
        return `You must be at least ${group.ageLimit} to join this group.`;
    }
    return null;
}

// group creation happens from two places, the direct POST /groups route and approving a
// group-create request, so the record is built and inserted in one place rather than twice.
// insertOne sets _id on the object it was given, so the caller can send it straight back.
async function createGroupRecord({ name, description, ageLimit, theme }, creatorEmail) {
    const newGroup = {
        name: String(name).trim(),
        description: description ?? '',
        ageLimit: Number(ageLimit) || 0,  // 0 means no age limit. the spec puts the limit on the group, and it covers every channel inside it
        theme: theme ?? '#5FA8D3',        // the group's colour, which carries through to its chat rooms
        adminEmails: [creatorEmail],      // the spec says a group must always have at least one admin, so whoever asked for it becomes the first one
        memberEmails: [creatorEmail],     // that admin is a member of the group as well
        bannedEmails: [],                 // group level bans. the account still exists, they just can't be in this group
    };
    await groups.insertOne(newGroup);
    return newGroup;
}

// a group name has to be unique across every group, optionally ignoring one group so that
// saving an edit form without touching the name doesn't collide with the group's own record.
async function nameTaken(name, exceptId) {
    const query = { name: String(name).trim() };
    if (exceptId) {
        query._id = { $ne: exceptId };
    }
    return await groups.findOne(query, CASE_INSENSITIVE);
}


//register route
app.post('/register', async (req, res) => {       // handles new user signups
    const { email, password, username, dob } = req.body;     // pull fields out of the request body

        if (!email || !password) {    // reject the request early if either field is missing/empty
            return res.status(400).json({ error: 'Email and password are required' });      // 400 = Bad Request, it tells the client (Angular) it sent invalid input,
    }

    const cleanEmail = normaliseEmail(email);       // compare and store the same tidied up version every time

        if (!looksLikeEmail(cleanEmail)) {
            return res.status(400).json({ error: 'That is not a valid email address' });
    }

        if (String(password).length < 6) {      // a minimum length is the one password rule worth having in a prototype
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existingUser = await users.findOne({ email: cleanEmail });        // check if email is already registered
        if (existingUser) {
            return res.status(409).json({ error: 'Email is already registered' });
    }

    // a system wide ban is permanent: the spec says the email can never be reused, so the
    // banned list is checked here rather than only at login. deleting the account isn't enough
    // on its own, because nothing would stop them signing up again with the same address.
    const isBanned = await banned.findOne({ email: cleanEmail });
        if (isBanned) {
            return res.status(403).json({ error: 'This email is permanently banned and cannot be reused' });
    }

    // bootstrap: the spec says exactly one super admin always exists, and nobody can create
    // that account through the UI. rather than editing the database by hand, the very first
    // account to register on an empty system becomes it. every account after that is a normal
    // user, so this can only ever happen once.
    const role = (await users.countDocuments()) === 0 ? 'super' : 'user';

    const newUser = {
        email: cleanEmail,
        password,
        role,
        username: (username ?? '').trim() || cleanEmail.split('@')[0],   // fall back to the part before the @ so nobody is nameless
        dob: dob ?? '',        // optional at signup, but needed before joining an age restricted group
        bio: '',
        createdAt: new Date().toISOString(),
    };

    await users.insertOne(newUser);
    await logAudit('User Registered', cleanEmail, role === 'super'
        ? 'First account on the system, promoted to super admin'
        : 'Self registered');

    // the client shows a different message for the bootstrap case, so the role goes back too
    res.status(201).json({ message: 'User registered successfully', email: cleanEmail, role });
});

//login route
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });      // 400 = Bad Request, it tells the client (Angular) it sent invalid input,
    }
    const cleanEmail = normaliseEmail(email);       // tidied the same way as register so a stored email always matches a typed one

    const user = await users.findOne({ email: cleanEmail }); // look for a user whose email matches the one submitted; null if none found

        if (!user || user.password !== password) {
            return res.status(401).json({ error: 'Invalid email or password' });
    }
    // role goes back too so Angular knows which pages to offer, and the profile fields go with
    // it so the profile page has something to show before it fetches anything
    res.status(200).json({ message: 'Login successful', ...publicUser(user) });
});


//users routes

app.get('/users', async (req, res) => {       // every registered account, for the super admin's members panel
    const all = await users.find().toArray();
    res.status(200).json(all.map(publicUser));      // map(publicUser) strips the password off every record
});

app.get('/users/:email', async (req, res) => {        // one account, used by the profile page to load fresh values rather than trusting localStorage
    const email = normaliseEmail(req.params.email);
    const user = await users.findOne({ email });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
    }
    res.status(200).json(publicUser(user));
});

// the spec says a user can edit every profile field except their email, because email is the
// unique identifier for the account. role isn't editable either, so nobody can promote themself
// to super admin by PUTing their own profile.
app.put('/users/:email', async (req, res) => {
    const email = normaliseEmail(req.params.email);
    const { username, dob, bio, password, actorEmail } = req.body;

    // only the account holder can edit their own profile. there is deliberately no admin
    // override: the spec says the super admin cannot create, edit or deactivate an account,
    // only permanently ban one. without this check anyone could PUT anyone's password.
        if (normaliseEmail(actorEmail) !== email) {
            return res.status(403).json({ error: 'You can only edit your own profile' });
    }

    const user = await users.findOne({ email });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
    }

    // built up as a $set rather than mutating and writing the whole record back, so an edit
    // only ever touches the fields that were actually sent
    const changes = {};

        if (username !== undefined) {
            if (!String(username).trim()) {
                return res.status(400).json({ error: 'Username cannot be empty' });
        }
            changes.username = String(username).trim();
    }

        if (dob !== undefined) {
            // an empty string is allowed, it means "clearing the date of birth", but a value
            // that's there has to actually be a date or the age check can't use it
            if (dob && ageFrom(dob) === null) {
                return res.status(400).json({ error: 'That is not a valid date of birth' });
        }
            changes.dob = dob;
    }

        if (bio !== undefined) {
            changes.bio = String(bio);
    }

        if (password !== undefined) {       // changing the password is part of editing the profile
            if (String(password).length < 6) {
                return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }
            changes.password = password;
    }

    // returnDocument: 'after' hands back the record as it now is, so the client renders what
    // is actually stored rather than what it hoped it sent
    const updated = Object.keys(changes).length
        ? await users.findOneAndUpdate({ email }, { $set: changes }, { returnDocument: 'after' })
        : user;

    await logAudit('Profile Updated', email, 'Edited their own profile');
    res.status(200).json(publicUser(updated));
});


//groups routes

app.get('/groups', async (req, res) => {      // send back every group, the dashboard uses this for both My Groups and Discover
    const all = await groups.find().toArray();
    res.status(200).json(all.map(normaliseGroup));
});

app.post('/groups', async (req, res) => {     // creates a group
    const { name, description, ageLimit, theme, creatorEmail } = req.body;

        if (!name || !creatorEmail) {       // a group with no name, or with nobody to admin it, isn't valid
            return res.status(400).json({ error: 'Group name and creator email are required' });
    }

        if (await nameTaken(name)) {        // stop two groups ending up with the same name
            return res.status(409).json({ error: 'A group with that name already exists' });
    }

    const creator = normaliseEmail(creatorEmail);

    const creatorUser = await users.findOne({ email: creator });
        if (!creatorUser) {     // same rule as adding a member, a group can't be owned by an email that was never registered
            return res.status(404).json({ error: 'User not found' });
    }
        if (creatorUser.role === 'super') {
            return res.status(409).json({ error: 'The super admin cannot create or admin a group' });
    }

    const newGroup = await createGroupRecord({ name, description, ageLimit, theme }, creator);
    await logAudit('Group Created', creator, `Created group "${newGroup.name}"`);
    res.status(201).json(newGroup);
});

// a group admin can change the name, description, theme colour and age limit at any time with
// no request needed, because the spec is explicit that only creating and deleting a group need the
// super admin. actorEmail is in the body so the server can check they really are an admin here.
app.patch('/groups/:id', async (req, res) => {
    const { name, description, ageLimit, theme, actorEmail } = req.body;
    const actor = normaliseEmail(actorEmail);

    const groupId = toObjectId(req.params.id);
    const group = normaliseGroup(groupId && await groups.findOne({ _id: groupId }));
        if (!group) {
            return res.status(404).json({ error: 'Group not found' });
    }
        if (!group.adminEmails.includes(actor)) {
            return res.status(403).json({ error: 'Only an admin of this group can edit it' });   // 403 = you're logged in, you just aren't allowed to do this
    }

    const changes = {};

        if (name !== undefined) {
            const cleanName = String(name).trim();
                if (!cleanName) {
                    return res.status(400).json({ error: 'Group name cannot be empty' });
            }
            // the same uniqueness rule as creation, minus this group itself, otherwise saving
            // the form without touching the name would collide with its own record
                if (await nameTaken(cleanName, group._id)) {
                    return res.status(409).json({ error: 'A group with that name already exists' });
            }
            changes.name = cleanName;
    }

        if (description !== undefined) {
            changes.description = String(description);
    }
        if (theme !== undefined) {
            changes.theme = theme;
    }

    let booted = [];
        if (ageLimit !== undefined) {
            const newLimit = Number(ageLimit) || 0;
            const raising = newLimit > (group.ageLimit ?? 0);
            changes.ageLimit = newLimit;

            // the spec says raising the age limit automatically removes members who no longer
            // meet it. only on a raise, because lowering it can't make anyone ineligible.
                if (raising) {
                    const members = await users.find({ email: { $in: group.memberEmails } }).toArray();
                    const byEmail = new Map(members.map(u => [u.email, u]));
                    booted = group.memberEmails.filter(email => {
                        if (group.adminEmails.includes(email)) {
                            return false;       // an admin isn't booted, that could empty adminEmails and break the group
                        }
                        const member = byEmail.get(email);
                        return !member || ageProblem(member, { ...group, ageLimit: newLimit }) !== null;
                    });
            }
    }

    // one write: the changed fields, plus anyone the new age limit pushed out. $pullAll takes
    // a list, so the boot and the edit can't end up as two writes that half apply.
    const update = { $set: changes };
        if (booted.length) {
            update.$pullAll = { memberEmails: booted };
    }

    const updated = normaliseGroup(await groups.findOneAndUpdate(
        { _id: group._id }, update, { returnDocument: 'after' }));

    await logAudit('Group Edited', actor, `Edited group "${updated.name}"`
        + (booted.length ? `, removed ${booted.length} member(s) under the new age limit` : ''));
    res.status(200).json({ group: updated, booted });   // booted goes back so the UI can say who was removed
});

// deleting a group is only reachable through an approved group-delete request, so this route
// takes the super admin's email and checks it rather than trusting the caller.
app.delete('/groups/:id', async (req, res) => {
    const actor = normaliseEmail(req.body?.actorEmail ?? req.query.actorEmail);

    const actorUser = await users.findOne({ email: actor });
        if (!actorUser || actorUser.role !== 'super') {
            return res.status(403).json({ error: 'Only the super admin can delete a group' });
    }

    const groupId = toObjectId(req.params.id);
    const group = groupId && await groups.findOne({ _id: groupId });
        if (!group) {
            return res.status(404).json({ error: 'Group not found' });
    }

    await groups.deleteOne({ _id: group._id });
    // a channel can't exist without its group, so its rooms go with it rather than being left
    // behind pointing at a groupId that no longer resolves
    await channels.deleteMany({ groupId: group._id });
    await logAudit('Group Deleted', actor, `Deleted group "${group.name}" and its rooms`);
    res.status(200).json({ message: 'Group deleted' });
});

app.post('/groups/:id/members', async (req, res) => {     // assigns an existing user to an existing group
    const email = normaliseEmail(req.body.email);

        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
    }

    const user = await users.findOne({ email });
        if (!user) {                        // don't let a group hold an email that was never registered
            return res.status(404).json({ error: 'User not found' });
    }

    const groupId = toObjectId(req.params.id);      // :id in the route path comes through as req.params.id
    const group = normaliseGroup(groupId && await groups.findOne({ _id: groupId }));
        if (!group) {
            return res.status(404).json({ error: 'Group not found' });
    }

        if (user.role === 'super') {
            return res.status(409).json({ error: 'The super admin cannot be added to a group' });
    }
        if (group.memberEmails.includes(email)) {
            return res.status(409).json({ error: 'User is already in this group' });
    }
        if (group.bannedEmails.includes(email)) {   // a group level ban is what stops them coming straight back in
            return res.status(403).json({ error: 'You are banned from this group' });
    }

    // the spec says users can see every group whatever their age, but are auto rejected when
    // they try to join one they're too young for. this is that rejection.
    const tooYoung = ageProblem(user, group);
        if (tooYoung) {
            return res.status(403).json({ error: tooYoung });
    }

    // $push appends inside the stored document, so the record never has to be read out and
    // written back, which is what used to lose a write when two people joined at once
    const updated = normaliseGroup(await groups.findOneAndUpdate(
        { _id: group._id }, { $push: { memberEmails: email } }, { returnDocument: 'after' }));

    await logAudit('Group Joined', email, `Joined group "${group.name}"`);
    res.status(200).json(updated);
});

app.delete('/groups/:id/members/:email', async (req, res) => {    // removes a user from a group, this is the group level ban/leave, not a system wide delete
    const email = normaliseEmail(req.params.email);

    const groupId = toObjectId(req.params.id);
    const group = normaliseGroup(groupId && await groups.findOne({ _id: groupId }));
        if (!group) {
            return res.status(404).json({ error: 'Group not found' });
    }

    // a group admin can remove a member, and a member can remove themself, which is what the
    // Leave button does. anyone else has no business doing either, so this is the same check
    // the ban and promote routes already make.
    const actor = normaliseEmail(req.query.actorEmail);
        if (actor !== email && !group.adminEmails.includes(actor)) {
            return res.status(403).json({ error: 'Only an admin of this group can remove a member' });
    }

        if (group.adminEmails.includes(email) && group.adminEmails.length === 1) {   // a group always needs at least one admin left behind
            return res.status(409).json({ error: 'Cannot remove the only admin of this group' });
    }

    // both lists in one $pull, so someone who was an admin as well as a member is dropped from
    // both in a single write rather than two that could half apply
    const updated = normaliseGroup(await groups.findOneAndUpdate(
        { _id: group._id },
        { $pull: { memberEmails: email, adminEmails: email } },
        { returnDocument: 'after' }));

    await logAudit('Member Removed', actor || email, `${email} left or was removed from "${group.name}"`);
    res.status(200).json(updated);
});

// group level ban. the account still exists and they keep every other group, so this only stops
// them being in this one, and unlike a system wide ban it can be lifted.
app.post('/groups/:id/bans', async (req, res) => {
    const email = normaliseEmail(req.body.email);
    const actor = normaliseEmail(req.body.actorEmail);
    const reason = String(req.body.reason ?? '').trim();

    const groupId = toObjectId(req.params.id);
    const group = normaliseGroup(groupId && await groups.findOne({ _id: groupId }));
        if (!group) {
            return res.status(404).json({ error: 'Group not found' });
    }

        if (!group.adminEmails.includes(actor)) {
            return res.status(403).json({ error: 'Only an admin of this group can ban a member' });
    }
        if (group.adminEmails.includes(email) && group.adminEmails.length === 1) {
            return res.status(409).json({ error: 'Promote another admin before banning the last one' });
    }
        if (group.bannedEmails.includes(email)) {
            return res.status(409).json({ error: 'That user is already banned from this group' });
    }

    // removed from both lists and added to the banned one in a single write
    const updated = normaliseGroup(await groups.findOneAndUpdate(
        { _id: group._id },
        { $pull: { memberEmails: email, adminEmails: email }, $push: { bannedEmails: email } },
        { returnDocument: 'after' }));

    await logAudit('Group Ban', actor, `Banned ${email} from "${group.name}"${reason ? `, reason: ${reason}` : ''}`);
    res.status(200).json(updated);
});

app.delete('/groups/:id/bans/:email', async (req, res) => {   // lifts a group level ban, which the spec allows because only system wide bans are permanent
    const email = normaliseEmail(req.params.email);
    const actor = normaliseEmail(req.query.actorEmail);

    const groupId = toObjectId(req.params.id);
    const group = normaliseGroup(groupId && await groups.findOne({ _id: groupId }));
        if (!group) {
            return res.status(404).json({ error: 'Group not found' });
    }

        if (!group.adminEmails.includes(actor)) {
            return res.status(403).json({ error: 'Only an admin of this group can lift a ban' });
    }

    const updated = normaliseGroup(await groups.findOneAndUpdate(
        { _id: group._id }, { $pull: { bannedEmails: email } }, { returnDocument: 'after' }));

    await logAudit('Group Ban Lifted', actor, `Lifted the ban on ${email} in "${group.name}"`);
    res.status(200).json(updated);
});

// promotion. the spec says an existing group admin can promote any member of that group, and
// there's no limit on how many admins a group has or how many groups you can admin.
app.post('/groups/:id/admins', async (req, res) => {
    const email = normaliseEmail(req.body.email);
    const actor = normaliseEmail(req.body.actorEmail);

    const groupId = toObjectId(req.params.id);
    const group = normaliseGroup(groupId && await groups.findOne({ _id: groupId }));
        if (!group) {
            return res.status(404).json({ error: 'Group not found' });
    }
        if (!group.adminEmails.includes(actor)) {
            return res.status(403).json({ error: 'Only an admin of this group can promote a member' });
    }
        if (!group.memberEmails.includes(email)) {      // you can only promote someone who is already in the group
            return res.status(404).json({ error: 'That user is not a member of this group' });
    }
        if (group.adminEmails.includes(email)) {
            return res.status(409).json({ error: 'That user is already an admin of this group' });
    }

    const updated = normaliseGroup(await groups.findOneAndUpdate(
        { _id: group._id }, { $push: { adminEmails: email } }, { returnDocument: 'after' }));

    await logAudit('Admin Promoted', actor, `Promoted ${email} to admin of "${group.name}"`);
    res.status(200).json(updated);
});

// demotion, including an admin stepping down themself. either way the rule is the same: the
// group can never be left with no admin, so the last one can't be demoted.
app.delete('/groups/:id/admins/:email', async (req, res) => {
    const email = normaliseEmail(req.params.email);
    const actor = normaliseEmail(req.query.actorEmail);

    const groupId = toObjectId(req.params.id);
    const group = normaliseGroup(groupId && await groups.findOne({ _id: groupId }));
        if (!group) {
            return res.status(404).json({ error: 'Group not found' });
    }
        if (!group.adminEmails.includes(actor)) {
            return res.status(403).json({ error: 'Only an admin of this group can demote an admin' });
    }
        if (!group.adminEmails.includes(email)) {
            return res.status(404).json({ error: 'That user is not an admin of this group' });
    }
        if (group.adminEmails.length === 1) {
            return res.status(409).json({ error: 'A group must always have at least one admin' });
    }

    const updated = normaliseGroup(await groups.findOneAndUpdate(       // they stay a member, they just stop being an admin
        { _id: group._id }, { $pull: { adminEmails: email } }, { returnDocument: 'after' }));

    await logAudit('Admin Demoted', actor,
        actor === email ? `Stepped down as admin of "${group.name}"` : `Demoted ${email} in "${group.name}"`);
    res.status(200).json(updated);
});


//channels routes

app.get('/channels', async (req, res) => {        // /channels lists them all, /channels?groupId=... lists just one group's channels
    const { groupId } = req.query;          // anything after the ? in the url ends up in req.query

        if (groupId) {
            const id = toObjectId(groupId);
                if (!id) {      // an id that isn't a real ObjectId can't match anything, so the answer is an empty list rather than an error
                    return res.status(200).json([]);
            }
            return res.status(200).json(await channels.find({ groupId: id }).toArray());
    }
    res.status(200).json(await channels.find().toArray());
});

app.post('/channels', async (req, res) => {       // creates a channel inside a group
    const { groupId, name } = req.body;
    const actor = normaliseEmail(req.body.actorEmail);

        if (!groupId || !name) {
            return res.status(400).json({ error: 'Group id and channel name are required' });
    }

    const id = toObjectId(groupId);
    const group = normaliseGroup(id && await groups.findOne({ _id: id }));
        if (!group) {      // a channel can't exist on its own, it has to belong to a real group
            return res.status(404).json({ error: 'Group not found' });
    }

    // only an admin creates a room outright. the spec says a regular member proposes one and
    // an admin approves it, so without this check the whole propose/approve flow is optional:
    // a member could just POST the room they were supposed to ask for.
        if (!group.adminEmails.includes(actor)) {
            return res.status(403).json({ error: 'Only an admin of this group can create a room. Propose it instead.' });
    }

    // two channels can share a name across different groups, just not inside the same one,
    // so the groupId is part of the query rather than the name being unique on its own
    const existingChannel = await channels.findOne({ groupId: id, name: String(name).trim() }, CASE_INSENSITIVE);
        if (existingChannel) {
            return res.status(409).json({ error: 'That group already has a channel with this name' });
    }

    // groupId is stored as an ObjectId, not the string it arrived as, so it matches the _id of
    // the group it points at. express turns it back into a hex string in the json response.
    const newChannel = { groupId: id, name: String(name).trim() };
    await channels.insertOne(newChannel);
    await logAudit('Room Created', actor, `Created room "${newChannel.name}" in "${group.name}"`);
    res.status(201).json(newChannel);
});

// the spec says a group admin can rename a room they created, to fix a typo for instance
app.patch('/channels/:id', async (req, res) => {
    const { name, actorEmail } = req.body;
    const actor = normaliseEmail(actorEmail);

    const channelId = toObjectId(req.params.id);
    const channel = channelId && await channels.findOne({ _id: channelId });
        if (!channel) {
            return res.status(404).json({ error: 'Channel not found' });
    }

    const group = normaliseGroup(await groups.findOne({ _id: channel.groupId }));
        if (!group || !group.adminEmails.includes(actor)) {
            return res.status(403).json({ error: 'Only an admin of this group can rename a room' });
    }

    const cleanName = String(name ?? '').trim();
        if (!cleanName) {
            return res.status(400).json({ error: 'Room name cannot be empty' });
    }
    const clash = await channels.findOne(
        { _id: { $ne: channel._id }, groupId: channel.groupId, name: cleanName }, CASE_INSENSITIVE);
        if (clash) {
            return res.status(409).json({ error: 'That group already has a channel with this name' });
    }

    const oldName = channel.name;
    const updated = await channels.findOneAndUpdate(
        { _id: channel._id }, { $set: { name: cleanName } }, { returnDocument: 'after' });

    await logAudit('Room Renamed', actor, `Renamed "${oldName}" to "${cleanName}" in "${group.name}"`);
    res.status(200).json(updated);
});

app.delete('/channels/:id', async (req, res) => {     // group admins can delete a room they made, so this removes one by id
    const channelId = toObjectId(req.params.id);
    const channel = channelId && await channels.findOne({ _id: channelId });

        if (!channel) {     // nothing matched that id
            return res.status(404).json({ error: 'Channel not found' });
    }

    // the same check PATCH /channels/:id makes. renaming a room was guarded and deleting it
    // was not, which meant anyone could delete any room in any group.
    const actor = normaliseEmail(req.query.actorEmail);
    const group = normaliseGroup(await groups.findOne({ _id: channel.groupId }));
        if (!group || !group.adminEmails.includes(actor)) {
            return res.status(403).json({ error: 'Only an admin of this group can delete a room' });
    }

    await channels.deleteOne({ _id: channel._id });
    await logAudit('Room Deleted', actor, `Deleted room "${channel.name}"`);
    res.status(200).json({ message: 'Channel deleted' });
});


//requests routes
//
// four things in the spec can't be done directly and have to be asked for:
//   group-create   a user asks the super admin for a new group, supplying the details up front
//   group-delete   a group admin asks the super admin to delete their group (or disband it)
//   channel-create a member proposes a room, the group admin approves or rejects it
//   user-ban       a group admin reports a user, the super admin actions the permanent ban
// they all live in one requests collection with a type field, because the approve/reject/reason
// mechanics are identical and only the action taken on approval differs.

const SUPER_TYPES = ['group-create', 'group-delete', 'user-ban'];   // these go to the super admin, the rest go to the group's admins

app.get('/requests', async (req, res) => {
    const { status, type, groupId, requestedBy, scope } = req.query;
    const query = {};

        if (status) {
            query.status = status;
    }
        if (type) {
            query.type = type;
    }
        if (groupId) {
            const id = toObjectId(groupId);
                if (!id) {      // same reasoning as /channels, an unmatchable id means an empty list
                    return res.status(200).json([]);
            }
            query.groupId = id;
    }
        if (requestedBy) {      // the profile page uses this so a user sees their own pending and rejected requests
            query.requestedBy = normaliseEmail(requestedBy);
    }
        // scope splits the super admin's queue from a group admin's queue without the client
        // having to know which types belong where
        if (scope === 'super') {
            query.type = { $in: SUPER_TYPES };
    }
        if (scope === 'group') {
            query.type = { $nin: SUPER_TYPES };
    }

    // newest first, which is what both queues want. mongo does the sort rather than the route
    // pulling everything into memory to sort it.
    res.status(200).json(await requests.find(query).sort({ createdAt: -1 }).toArray());
});

app.post('/requests', async (req, res) => {
    const { type, requestedBy, groupId, payload } = req.body;
    const requester = normaliseEmail(requestedBy);

        if (!type || !requester) {
            return res.status(400).json({ error: 'Request type and requester are required' });
    }

    const requesterUser = await users.findOne({ email: requester });
        if (!requesterUser) {
            return res.status(404).json({ error: 'User not found' });
    }
        // the spec says the super admin only actions requests and can never raise one, which
        // is also what stops them approving their own
        if (requesterUser.role === 'super') {
            return res.status(403).json({ error: 'The super admin cannot raise requests, only action them' });
    }

    // group-create has no group yet, so its groupId is null rather than an ObjectId
    const targetGroupId = groupId ? toObjectId(groupId) : null;
    const details = payload ?? {};
    let summary = '';

    // each type has its own validation, because what makes a request valid is different for
    // each one. the switch keeps them next to each other instead of scattered through the file.
    switch (type) {
        case 'group-create': {
            const name = String(details.name ?? '').trim();
                if (!name) {
                    return res.status(400).json({ error: 'Group name is required' });
            }
                if (await nameTaken(name)) {
                    return res.status(409).json({ error: 'A group with that name already exists' });
            }
                // names are unique, so two people can't have the same name pending either
                if (await requests.findOne({ status: 'pending', type: 'group-create', 'payload.name': name }, CASE_INSENSITIVE)) {
                    return res.status(409).json({ error: 'A group with that name has already been requested' });
            }
            summary = `Create group "${name}"`;
            break;
        }

        case 'group-delete': {
            const group = normaliseGroup(targetGroupId && await groups.findOne({ _id: targetGroupId }));
                if (!group) {
                    return res.status(404).json({ error: 'Group not found' });
            }
                if (!group.adminEmails.includes(requester)) {
                    return res.status(403).json({ error: 'Only an admin of this group can request its deletion' });
            }
                if (await requests.findOne({ status: 'pending', type: 'group-delete', groupId: targetGroupId })) {
                    return res.status(409).json({ error: 'A deletion request for this group is already pending' });
            }
            summary = `Delete group "${group.name}"`;
            break;
        }

        case 'channel-create': {
            const group = normaliseGroup(targetGroupId && await groups.findOne({ _id: targetGroupId }));
                if (!group) {
                    return res.status(404).json({ error: 'Group not found' });
            }
                if (!group.memberEmails.includes(requester)) {      // you propose a room in a group you're actually in
                    return res.status(403).json({ error: 'You must be a member of this group to propose a room' });
            }
            const roomName = String(details.name ?? '').trim();
                if (!roomName) {
                    return res.status(400).json({ error: 'Room name is required' });
            }
                if (await channels.findOne({ groupId: targetGroupId, name: roomName }, CASE_INSENSITIVE)) {
                    return res.status(409).json({ error: 'That group already has a channel with this name' });
            }
                if (await requests.findOne({ status: 'pending', type: 'channel-create', groupId: targetGroupId, 'payload.name': roomName }, CASE_INSENSITIVE)) {
                    return res.status(409).json({ error: 'That room has already been proposed' });
            }
            summary = `Create room "${roomName}" in "${group.name}"`;
            break;
        }

        case 'user-ban': {
            const target = normaliseEmail(details.email);
            const group = normaliseGroup(targetGroupId && await groups.findOne({ _id: targetGroupId }));
                if (!group) {
                    return res.status(404).json({ error: 'Group not found' });
            }
                // "admins cannot ban directly without a prior report". the report is this
                // request, and only a group admin can raise it
                if (!group.adminEmails.includes(requester)) {
                    return res.status(403).json({ error: 'Only a group admin can report a user for a system wide ban' });
            }
            const targetUser = await users.findOne({ email: target });
                if (!targetUser) {
                    return res.status(404).json({ error: 'That user does not exist' });
            }
                if (targetUser.role === 'super') {
                    return res.status(403).json({ error: 'The super admin cannot be banned' });
            }
                if (target === requester) {
                    return res.status(400).json({ error: 'You cannot report yourself' });
            }
                if (!String(details.reason ?? '').trim()) {   // a ban report without a reason is not actionable
                    return res.status(400).json({ error: 'A reason is required to report a user' });
            }
                // the spec says a replacement admin must be assigned before removing someone
                // who is a group admin, so the ban is refused until that's done
                const stillAdminSomewhere = await groups.findOne({ adminEmails: target, 'adminEmails.1': { $exists: false } });
                if (stillAdminSomewhere) {
                    return res.status(409).json({ error: `${target} is the only admin of "${stillAdminSomewhere.name}". Assign a replacement admin there first.` });
            }
                if (await requests.findOne({ status: 'pending', type: 'user-ban', 'payload.email': target })) {
                    return res.status(409).json({ error: 'A ban request for that user is already pending' });
            }
            summary = `Permanently ban ${target}`;
            break;
        }

        default:
            return res.status(400).json({ error: 'Unknown request type' });
    }

    const newRequest = {
        type,
        status: 'pending',      // pending -> approved or rejected. the spec says there's no cancelling, so there's no route that sets it back
        summary,                // written once here so every queue can render a row without re-deriving the wording
        requestedBy: requester,
        groupId: targetGroupId,
        payload: details,
        createdAt: new Date().toISOString(),
        resolvedAt: '',
        resolvedBy: '',
        reason: '',             // only filled in on a rejection, which the spec requires a reason for
    };

    await requests.insertOne(newRequest);
    await logAudit('Request Raised', requester, summary);
    res.status(201).json(newRequest);
});

app.post('/requests/:id/approve', async (req, res) => {
    const actor = normaliseEmail(req.body.actorEmail);

    const requestId = toObjectId(req.params.id);
    const request = requestId && await requests.findOne({ _id: requestId });
        if (!request) {
            return res.status(404).json({ error: 'Request not found' });
    }
        if (request.status !== 'pending') {
            return res.status(409).json({ error: 'That request has already been actioned' });
    }
        // spelled out even though POST /requests already blocks the super admin from raising
        // one, because the same rule applies to a group admin approving their own proposal
        if (request.requestedBy === actor) {
            return res.status(403).json({ error: 'You cannot approve your own request' });
    }

    const actorUser = await users.findOne({ email: actor });
        if (!actorUser) {
            return res.status(404).json({ error: 'User not found' });
    }

    // who is allowed to action this depends on the type: the super admin for the three system
    // level ones, an admin of the group in question for a room proposal
        if (SUPER_TYPES.includes(request.type)) {
            if (actorUser.role !== 'super') {
                return res.status(403).json({ error: 'Only the super admin can action this request' });
        }
    } else {
            const group = normaliseGroup(await groups.findOne({ _id: request.groupId }));
            if (!group || !group.adminEmails.includes(actor)) {
                return res.status(403).json({ error: 'Only an admin of this group can action this request' });
        }
    }

    // carrying out the request is the whole point of approving it, so each type does its work here
    switch (request.type) {
        case 'group-create': {
            // re-checked at approval time, not just when the request was raised, because a
            // group with this name could have been created while the request sat in the queue.
            // the two cases below re-check their own rules for exactly the same reason, and
            // without this the "group names are unique" rule breaks on an approval.
            const wantedName = String(request.payload.name ?? '').trim();
                if (await nameTaken(wantedName)) {
                    return res.status(409).json({ error: 'A group with that name already exists' });
            }
            const created = await createGroupRecord(request.payload, request.requestedBy);
            await logAudit('Group Created', actor, `Approved "${created.name}", ${request.requestedBy} is its first admin`);
            break;
        }

        case 'group-delete': {
            const group = await groups.findOne({ _id: request.groupId });
                if (!group) {
                    return res.status(404).json({ error: 'Group not found' });
            }
            await groups.deleteOne({ _id: group._id });
            await channels.deleteMany({ groupId: group._id });
            await logAudit('Group Deleted', actor, `Approved deletion of "${group.name}" and its rooms`);
            break;
        }

        case 'channel-create': {
            const roomName = String(request.payload.name).trim();
                // re-checked at approval time, not just when the request was raised, because an admin
                // could have created a room with the same name while this sat in the queue
                if (await channels.findOne({ groupId: request.groupId, name: roomName }, CASE_INSENSITIVE)) {
                    return res.status(409).json({ error: 'That group already has a channel with this name' });
            }
            await channels.insertOne({ groupId: request.groupId, name: roomName });
            await logAudit('Room Created', actor, `Approved room "${roomName}" proposed by ${request.requestedBy}`);
            break;
        }

        case 'user-ban': {
            const target = normaliseEmail(request.payload.email);
                // re-checked here too: someone could have been left as a group's only admin
                // since the report was raised, and the spec says a replacement comes first
                const onlyAdminOf = await groups.findOne({ adminEmails: target, 'adminEmails.1': { $exists: false } });
                if (onlyAdminOf) {
                    return res.status(409).json({ error: `${target} is the only admin of "${onlyAdminOf.name}". A replacement admin must be assigned before the ban.` });
            }

            // a system wide ban is permanent, so it happens in three parts: the account is
            // deleted, they're pulled out of every group, and the email goes on the banned
            // list so /register can never hand it out again
            await users.deleteOne({ email: target });

            // one updateMany instead of rewriting every group, so groups the user was never in
            // are not touched at all
            await groups.updateMany(
                { $or: [{ memberEmails: target }, { adminEmails: target }] },
                { $pull: { memberEmails: target, adminEmails: target } });

            await banned.insertOne({
                email: target,
                reason: request.payload.reason ?? '',
                reportedBy: request.requestedBy,
                bannedAt: new Date().toISOString(),
                bannedBy: actor,
            });
            await logAudit('User Banned', actor, `Permanently banned ${target}. Reason: ${request.payload.reason ?? 'no reason given'}`);
            break;
        }
    }

    const updated = await requests.findOneAndUpdate(
        { _id: request._id },
        { $set: { status: 'approved', resolvedAt: new Date().toISOString(), resolvedBy: actor } },
        { returnDocument: 'after' });

    res.status(200).json(updated);
});

app.post('/requests/:id/reject', async (req, res) => {
    const actor = normaliseEmail(req.body.actorEmail);
    const reason = String(req.body.reason ?? '').trim();

        // the spec is explicit that a rejected request must include a reason, so this is a
        // 400 rather than something the client is trusted to enforce
        if (!reason) {
            return res.status(400).json({ error: 'A reason is required when rejecting a request' });
    }

    const requestId = toObjectId(req.params.id);
    const request = requestId && await requests.findOne({ _id: requestId });
        if (!request) {
            return res.status(404).json({ error: 'Request not found' });
    }
        if (request.status !== 'pending') {
            return res.status(409).json({ error: 'That request has already been actioned' });
    }
        if (request.requestedBy === actor) {
            return res.status(403).json({ error: 'You cannot action your own request' });
    }

    const actorUser = await users.findOne({ email: actor });
        if (!actorUser) {
            return res.status(404).json({ error: 'User not found' });
    }

    // the same authority check as approve, because rejecting is just as much an admin action
        if (SUPER_TYPES.includes(request.type)) {
            if (actorUser.role !== 'super') {
                return res.status(403).json({ error: 'Only the super admin can action this request' });
        }
    } else {
            const group = normaliseGroup(await groups.findOne({ _id: request.groupId }));
            if (!group || !group.adminEmails.includes(actor)) {
                return res.status(403).json({ error: 'Only an admin of this group can action this request' });
        }
    }

    const updated = await requests.findOneAndUpdate(
        { _id: request._id },
        { $set: {
            status: 'rejected',
            reason,                 // the user sees this on their profile page under past rejected requests
            resolvedAt: new Date().toISOString(),
            resolvedBy: actor,
        } },
        { returnDocument: 'after' });

    await logAudit('Request Rejected', actor, `${request.summary}. Rejected: ${reason}`);
    res.status(200).json(updated);
});


//bans and audit routes

app.get('/bans', async (req, res) => {        // every permanently banned account, the super admin sees these system wide
    res.status(200).json(await banned.find().toArray());
});

// the spec asks for an audit log page that's filterable by type and in date order, so the
// filtering and the sorting both happen here rather than in the component
app.get('/audit', async (req, res) => {
    const { type } = req.query;
    const query = type ? { type } : {};

    res.status(200).json(await audit.find(query).sort({ at: -1 }).toArray());   // newest first
});

// the distinct types actually present in the log, so the filter dropdown lists real values
// instead of a hardcoded list that drifts out of date. distinct() is a mongo command, so the
// whole log never has to be read into memory just to find the unique values.
app.get('/audit/types', async (req, res) => {
    const types = await audit.distinct('type');
    res.status(200).json(types.sort());
});


// express 5 catches a rejected promise from an async route handler and passes it here, so a
// failed mongo call answers with a 500 instead of leaving the request hanging forever.
// express 4 did not do this, which is why most tutorials wrap every route in try/catch.
// four arguments is what marks this as express's error handler rather than another route.
app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server' });
});


const PORT = 3000;

// the server only starts listening once mongo is connected, so a request can never arrive
// while the collection handles above are still undefined.
async function start() {
    const client = new MongoClient(MONGO_URL);
    await client.connect();

    const db = client.db(DB_NAME);
    users = db.collection('users');
    groups = db.collection('groups');
    channels = db.collection('channels');
    requests = db.collection('requests');
    audit = db.collection('audit');
    banned = db.collection('banned');

    console.log(`Connected to MongoDB at ${MONGO_URL}/${DB_NAME}`);

    app.listen(PORT, () => {
        console.log(`Server listening on port ${PORT}`);
    });
}

start().catch(err => {      // if mongo isn't running there's nothing useful the app can do, so fail loudly instead of serving broken routes
    console.error('Failed to start server:', err);
    process.exit(1);
});
