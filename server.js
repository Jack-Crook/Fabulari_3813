const http = require('http');                    // socket.io needs the raw http server, not the express app
const { Server } = require('socket.io');


const express = require('express');
const cors = require('cors');// angular (:4200) and express (:3000) are different origins, so the browser
                            // blocks angular's requests unless cors() adds the allow header
const { MongoClient, ObjectId } = require('mongodb');   // ObjectId turns an id from a url back into mongo's type
const bcrypt = require('bcrypt');       // one way password hashing
const multer = require('multer');       // reads multipart/form-data (file uploads), which express.json() can't
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');       // randomUUID() names each uploaded file

const app = express();

app.use(cors());            // allow requests from angular on :4200
app.use(express.json());    // parse JSON bodies into req.body

// uploaded images live on disk in uploads/, mongo only stores the path. gitignored.
const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });     // no error if it already exists

// serves the images. nosniff stops the browser guessing the type from the bytes.
app.use('/uploads', express.static(UPLOAD_DIR, {
    setHeaders: res => res.set('X-Content-Type-Options', 'nosniff'),
}));

app.get('/', (req, res) => {            // health check
  res.send('Fabulari API running');
});


// one mongo collection per type. data/*.json is now only the seed for `npm run seed`.
const MONGO_URL = process.env.MONGO_URL ?? 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME ?? 'fabulari';

let users;      // set by start() before the server listens, so no route sees them undefined
let groups;
let channels;
let requests;
let audit;
let banned;
let messages;


// a url id is a hex string and needs converting to an ObjectId. a malformed one makes the
// constructor throw, so this returns null and the caller answers 404.
function toObjectId(value) {
    return ObjectId.isValid(value) ? new ObjectId(value) : null;
}

// bcrypt cost: 2^10 rounds, its default. stored inside the hash with a random salt, so equal
// passwords hash differently and the cost can be raised later.
const SALT_ROUNDS = 10;

// email is the unique identifier, so it's always trimmed and lowercased
function normaliseEmail(email) {
    return String(email ?? '').trim().toLowerCase();
}

// basic shape check only: something@something.something
function looksLikeEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// case-insensitive matching for group and room names. same collation as the unique index in ensureIndexes().
const CASE_INSENSITIVE = { collation: { locale: 'en', strength: 2 } };

// length limits, so one request can't store a novel or break the layout
const MAX_NAME = 50;            // group, room and display names
const MAX_TEXT = 500;           // descriptions and bios
const MAX_MESSAGE = 2000;       // one chat message

// a theme is what <input type="color"> produces: # and six hex digits
const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

// 0 (no limit) to 120, whole years only
function validAgeLimit(value) {
    const years = Number(value);
    return Number.isInteger(years) && years >= 0 && years <= 120;
}

// why a date of birth can't be stored, or null if it can. '' is allowed, it means not set.
function dobProblem(dob) {
    if (!dob) {
        return null;
    }
    const age = ageFrom(dob);
    if (age === null) {
        return 'That is not a valid date of birth';
    }
    if (age < 0) {
        return 'Date of birth can\'t be in the future';
    }
    return null;
}

// the group's details on create and on edit. returns why they're refused, or null.
// undefined means not sent, which is fine: the create uses defaults and the edit leaves it alone.
function groupDetailsProblem({ name, description, ageLimit, theme }) {
    if (name !== undefined && String(name).trim().length > MAX_NAME) {
        return `Group names can be at most ${MAX_NAME} characters`;
    }
    if (description !== undefined && String(description).length > MAX_TEXT) {
        return `Descriptions can be at most ${MAX_TEXT} characters`;
    }
    if (ageLimit !== undefined && !validAgeLimit(ageLimit)) {
        return 'Age limit must be a whole number from 0 to 120';
    }
    if (theme !== undefined && !HEX_COLOUR.test(String(theme))) {
        return 'Theme must be a colour like #5FA8D3';
    }
    return null;
}

// the reply when a conditional update below matches nothing: the group changed between the
// route's checks and its write, e.g. two admins acting at the same moment
const GROUP_CHANGED = 'The group changed at the same time. Refresh and try again.';

// what a user looks like in every response: no password, no _id
function publicUser(user) {
    return {
        email: user.email,
        role: user.role,
        username: user.username ?? '',
        dob: user.dob ?? '',
        bio: user.bio ?? '',
        avatarUrl: user.avatarUrl ?? '',    // '' = no profile picture
        createdAt: user.createdAt ?? '',
    };
}

// older group records have no bannedEmails, and .includes() on undefined throws
function normaliseGroup(group) {
    if (group) {
        group.bannedEmails = group.bannedEmails ?? [];
    }
    return group;
}

// age in whole years from yyyy-mm-dd. null means unknown, which is not the same as too young.
function ageFrom(dob) {
    if (!dob) {
        return null;
    }
    const born = new Date(dob);
    if (isNaN(born.getTime())) {      // not a real date
        return null;
    }
    const now = new Date();
    let age = now.getFullYear() - born.getFullYear();
    const monthsIn = now.getMonth() - born.getMonth();
    if (monthsIn < 0 || (monthsIn === 0 && now.getDate() < born.getDate())) {
        age = age - 1;                  // birthday not reached yet this year
    }
    return age;
}

// every change is logged for the super admin's audit page
async function logAudit(type, actor, detail) {
    await audit.insertOne({
        at: new Date().toISOString(),   // ISO, so string order = date order
        type,
        actor,
        detail,
    });
}

// returns why a user can't be in a group, or null if they can
function ageProblem(user, group) {
    if (!group.ageLimit) {            // 0 = no age limit
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

// only called when a group-create request is approved. there is no POST /groups on purpose,
// so the super admin can't be bypassed. insertOne sets _id on newGroup.
async function createGroupRecord({ name, description, ageLimit, theme }, creatorEmail) {
    const newGroup = {
        name: String(name).trim(),
        description: description ?? '',
        ageLimit: Number(ageLimit) || 0,  // 0 = no limit. covers every room in the group
        theme: theme ?? '#5FA8D3',        // carries into the group's chat rooms
        adminEmails: [creatorEmail],      // the requester is the first admin
        memberEmails: [creatorEmail],
        bannedEmails: [],                 // group level bans
    };
    await groups.insertOne(newGroup);
    return newGroup;
}

// deletes messages and their image files. the paths are read first, because after the
// delete there's nothing left to read them from.
async function deleteMessages(filter) {
    const withImages = await messages.find({ ...filter, imageUrl: { $ne: '' } }, { projection: { imageUrl: 1 } }).toArray();
    await messages.deleteMany(filter);
    // basename() keeps the delete inside uploads/. force: a missing file isn't an error.
    await Promise.all(withImages.map(m =>
        fs.promises.rm(path.join(UPLOAD_DIR, path.basename(m.imageUrl)), { force: true })));
}

// rejects pending requests whose group or requester no longer exists. rejected rather than
// deleted, so the requester still sees the reason on their profile.
async function closePendingRequests(filter, reason, actor) {
    const result = await requests.updateMany(
        { ...filter, status: 'pending' },
        { $set: { status: 'rejected', reason, resolvedAt: new Date().toISOString(), resolvedBy: actor } });
    if (result.modifiedCount) {
        await logAudit('Requests Closed', actor, `${result.modifiedCount} pending request(s) closed: ${reason}`);
        announceRequestsChanged(filter.groupId);
    }
}

// tells every open page that a request was raised or actioned, so the queues and dashboards update
// straight away instead of on the next reload. only the group id is sent: each page then refetches
// what it's allowed to see over REST, so nothing private goes out to everyone.
function announceRequestsChanged(groupId) {
    io.emit('requestsChanged', { groupId: groupId ? String(groupId) : null });
}

// deletes one uploaded file by its stored path. '' means nothing to delete.
async function removeUploadedFile(url) {
    if (url) {
        await fs.promises.rm(path.join(UPLOAD_DIR, path.basename(url)), { force: true });
    }
}

// group names are unique. exceptId skips the group being edited so it doesn't clash with itself.
async function nameTaken(name, exceptId) {
    const query = { name: String(name).trim() };
    if (exceptId) {
        query._id = { $ne: exceptId };
    }
    return await groups.findOne(query, CASE_INSENSITIVE);
}


//register route
app.post('/register', async (req, res) => {
    const { email, password, username, dob } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });      // 400 = bad input
    }

    const cleanEmail = normaliseEmail(email);

        if (!looksLikeEmail(cleanEmail)) {
            return res.status(400).json({ error: 'That is not a valid email address' });
    }

        if (String(password).length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

        if (String(username ?? '').trim().length > MAX_NAME) {
            return res.status(400).json({ error: `Display names can be at most ${MAX_NAME} characters` });
    }

    const badDob = dobProblem(dob);
        if (badDob) {
            return res.status(400).json({ error: badDob });
    }

    const existingUser = await users.findOne({ email: cleanEmail });
        if (existingUser) {
            return res.status(409).json({ error: 'Email is already registered' });
    }

    // a system wide ban is permanent, so a banned email can never sign up again
    const isBanned = await banned.findOne({ email: cleanEmail });
        if (isBanned) {
            return res.status(403).json({ error: 'This email is permanently banned and cannot be reused' });
    }

    // the first account on an empty system becomes the one super admin. can only happen once.
    const role = (await users.countDocuments()) === 0 ? 'super' : 'user';

    const newUser = {
        email: cleanEmail,
        password: await bcrypt.hash(password, SALT_ROUNDS),   // only the hash is stored
        role,
        username: (username ?? '').trim() || cleanEmail.split('@')[0],   // default: the part before the @
        dob: dob ?? '',        // optional, but needed to join an age limited group
        bio: '',
        avatarUrl: '',
        createdAt: new Date().toISOString(),
    };

    await users.insertOne(newUser);
    await logAudit('User Registered', cleanEmail, role === 'super'
        ? 'First account on the system, promoted to super admin'
        : 'Self registered');

    // role goes back so the client can show the super admin message
    res.status(201).json({ message: 'User registered successfully', email: cleanEmail, role });
});

//login route
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
    }
    const cleanEmail = normaliseEmail(email);

    const user = await users.findOne({ email: cleanEmail });

    // compare() hashes the typed password with the stored salt. unknown email and wrong
    // password get the same answer, so this doesn't reveal who has an account.
        if (!user || !(await bcrypt.compare(String(password), user.password))) {
            return res.status(401).json({ error: 'Invalid email or password' });
    }
    res.status(200).json({ message: 'Login successful', ...publicUser(user) });
});


//users routes

app.get('/users', async (req, res) => {       // every account, for the super admin's members panel
    const all = await users.find().toArray();
    res.status(200).json(all.map(publicUser));
});

app.get('/users/:email', async (req, res) => {        // one account, for the profile page
    const email = normaliseEmail(req.params.email);
    const user = await users.findOne({ email });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
    }
    res.status(200).json(publicUser(user));
});

// edit your own profile. email (the identifier) and role can't be changed.
app.put('/users/:email', async (req, res) => {
    const email = normaliseEmail(req.params.email);
    const { username, dob, bio, password, actorEmail } = req.body;

    // own profile only. the spec gives the super admin no edit power over accounts.
        if (normaliseEmail(actorEmail) !== email) {
            return res.status(403).json({ error: 'You can only edit your own profile' });
    }

    const user = await users.findOne({ email });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
    }

    // only the fields that were sent go into the $set
    const changes = {};

        if (username !== undefined) {
            if (!String(username).trim()) {
                return res.status(400).json({ error: 'Username cannot be empty' });
        }
            if (String(username).trim().length > MAX_NAME) {
                return res.status(400).json({ error: `Display names can be at most ${MAX_NAME} characters` });
        }
            changes.username = String(username).trim();
    }

        if (dob !== undefined) {
            // '' clears it, anything else has to be a real date that isn't in the future
            const badDob = dobProblem(dob);
            if (badDob) {
                return res.status(400).json({ error: badDob });
        }
            changes.dob = dob;
    }

        if (bio !== undefined) {
            if (String(bio).length > MAX_TEXT) {
                return res.status(400).json({ error: `Bios can be at most ${MAX_TEXT} characters` });
        }
            changes.bio = String(bio);
    }

        if (password !== undefined) {
            if (String(password).length < 6) {
                return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }
            changes.password = await bcrypt.hash(password, SALT_ROUNDS);    // hashed here too
    }

    // nothing sent, nothing to save or log
        if (!Object.keys(changes).length) {
            return res.status(200).json(publicUser(user));
    }

    // returnDocument: 'after' returns the saved record
    const updated = await users.findOneAndUpdate({ email }, { $set: changes }, { returnDocument: 'after' });

    await logAudit('Profile Updated', email, 'Edited their own profile');
    res.status(200).json(publicUser(updated));
});


//groups routes

app.get('/groups', async (req, res) => {      // every group, for My Groups and Discover
    const all = await groups.find().toArray();
    res.status(200).json(all.map(normaliseGroup));
});

// a group admin edits name, description, theme or age limit. no request needed.
app.patch('/groups/:id', async (req, res) => {
    const { name, description, ageLimit, theme, actorEmail } = req.body;
    const actor = normaliseEmail(actorEmail);

    const groupId = toObjectId(req.params.id);
    const group = normaliseGroup(groupId && await groups.findOne({ _id: groupId }));
        if (!group) {
            return res.status(404).json({ error: 'Group not found' });
    }
        if (!group.adminEmails.includes(actor)) {
            return res.status(403).json({ error: 'Only an admin of this group can edit it' });   // 403 = not allowed
    }

    const badDetails = groupDetailsProblem({ name, description, ageLimit, theme });
        if (badDetails) {
            return res.status(400).json({ error: badDetails });
    }

    const changes = {};

        if (name !== undefined) {
            const cleanName = String(name).trim();
                if (!cleanName) {
                    return res.status(400).json({ error: 'Group name cannot be empty' });
            }
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

            // raising the limit removes members who no longer meet it
                if (raising) {
                    const members = await users.find({ email: { $in: group.memberEmails } }).toArray();
                    const byEmail = new Map(members.map(u => [u.email, u]));
                    booted = group.memberEmails.filter(email => {
                        if (group.adminEmails.includes(email)) {
                            return false;       // never an admin, the group could end up with none
                        }
                        const member = byEmail.get(email);
                        return !member || ageProblem(member, { ...group, ageLimit: newLimit }) !== null;
                    });
            }
    }

    // the edit and the removals in one write
    const update = { $set: changes };
        if (booted.length) {
            update.$pullAll = { memberEmails: booted };
    }

    const updated = normaliseGroup(await groups.findOneAndUpdate(
        { _id: group._id }, update, { returnDocument: 'after' }));

    // anyone removed who is sitting in one of the group's rooms is taken out of it
    await removeFromRooms(room => booted.includes(room.email) && String(room.groupId) === String(group._id),
        'You were removed from this group by its new age limit');

    await logAudit('Group Edited', actor, `Edited group "${updated.name}"`
        + (booted.length ? `, removed ${booted.length} member(s) under the new age limit` : ''));
    res.status(200).json({ group: updated, booted });   // booted so the UI can say who was removed
});

// super admin only. the UI reaches deletion through an approved group-delete request.
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

    // rooms read first, so their messages can be matched before the rooms are gone
    const doomed = await channels.find({ groupId: group._id }).toArray();
    await deleteMessages({ channelId: { $in: doomed.map(c => c._id) } });

    await groups.deleteOne({ _id: group._id });
    await channels.deleteMany({ groupId: group._id });     // rooms go with their group
    await removeFromRooms(room => String(room.groupId) === String(group._id), 'This group has been deleted');
    await closePendingRequests({ groupId: group._id }, 'The group was deleted', actor);
    await logAudit('Group Deleted', actor, `Deleted group "${group.name}" and its rooms`);
    res.status(200).json({ message: 'Group deleted' });
});

// email, name and picture of each member, for the chat room. nothing else, profiles are private.
app.get('/groups/:id/members', async (req, res) => {
    const groupId = toObjectId(req.params.id);
    const group = groupId && await groups.findOne({ _id: groupId });
        if (!group) {
            return res.status(404).json({ error: 'Group not found' });
    }

    const members = await users.find({ email: { $in: group.memberEmails } }).toArray();   // one query for all
    res.status(200).json(members.map(u => ({
        email: u.email,
        username: u.username ?? '',
        avatarUrl: u.avatarUrl ?? '',
    })));
});

// there's no route to join a group directly. joining is a group-join request that an admin of the
// group approves (POST /requests, then POST /requests/:id/approve), so it can't be skipped.

app.delete('/groups/:id/members/:email', async (req, res) => {    // leave, or an admin removes a member
    const email = normaliseEmail(req.params.email);

    const groupId = toObjectId(req.params.id);
    const group = normaliseGroup(groupId && await groups.findOne({ _id: groupId }));
        if (!group) {
            return res.status(404).json({ error: 'Group not found' });
    }

    // yourself, or an admin of this group
    const actor = normaliseEmail(req.query.actorEmail);
        if (actor !== email && !group.adminEmails.includes(actor)) {
            return res.status(403).json({ error: 'Only an admin of this group can remove a member' });
    }

        if (!group.memberEmails.includes(email)) {
            return res.status(404).json({ error: 'That user is not a member of this group' });
    }
        if (group.adminEmails.includes(email) && group.adminEmails.length === 1) {   // a group always keeps an admin
            return res.status(409).json({ error: 'Cannot remove the only admin of this group' });
    }

    // removed from both lists in one write. the filter repeats the last admin rule, so it holds even
    // if two admins act at once: it only matches if they aren't an admin, or a second admin exists
    // ('adminEmails.1' is the second entry in the array)
    const updated = normaliseGroup(await groups.findOneAndUpdate(
        { _id: group._id, $or: [{ adminEmails: { $ne: email } }, { 'adminEmails.1': { $exists: true } }] },
        { $pull: { memberEmails: email, adminEmails: email } },
        { returnDocument: 'after' }));
        if (!updated) {
            return res.status(409).json({ error: GROUP_CHANGED });
    }

    // if they're in one of the group's rooms right now, they stop receiving its messages
    await removeFromRooms(room => room.email === email && String(room.groupId) === String(group._id),
        'You are no longer a member of this group');

    await logAudit('Member Removed', actor || email, `${email} left or was removed from "${group.name}"`);
    res.status(200).json(updated);
});

// group level ban: they lose this group only, and it can be lifted
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
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
    }
        if (!(await users.findOne({ email }))) {
            return res.status(404).json({ error: 'User not found' });
    }
        if (group.adminEmails.includes(email) && group.adminEmails.length === 1) {
            return res.status(409).json({ error: 'Promote another admin before banning the last one' });
    }
        if (group.bannedEmails.includes(email)) {
            return res.status(409).json({ error: 'That user is already banned from this group' });
    }

    // out of both lists and onto the banned list, in one write. the filter repeats the two checks
    // above so they still hold if someone else changes the group at the same moment.
    const updated = normaliseGroup(await groups.findOneAndUpdate(
        { _id: group._id, bannedEmails: { $ne: email },
          $or: [{ adminEmails: { $ne: email } }, { 'adminEmails.1': { $exists: true } }] },
        { $pull: { memberEmails: email, adminEmails: email }, $push: { bannedEmails: email } },
        { returnDocument: 'after' }));
        if (!updated) {
            return res.status(409).json({ error: GROUP_CHANGED });
    }

    await removeFromRooms(room => room.email === email && String(room.groupId) === String(group._id),
        'You were banned from this group');
    // a request to join that's still waiting can't be approved now
    await closePendingRequests({ type: 'group-join', groupId: group._id, requestedBy: email },
        'You were banned from this group', actor);

    await logAudit('Group Ban', actor, `Banned ${email} from "${group.name}"${reason ? `, reason: ${reason}` : ''}`);
    res.status(200).json(updated);
});

app.delete('/groups/:id/bans/:email', async (req, res) => {   // lift a group level ban
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

// promote a member. no limit on admins per group.
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
        if (!group.memberEmails.includes(email)) {      // members only
            return res.status(404).json({ error: 'That user is not a member of this group' });
    }
        if (group.adminEmails.includes(email)) {
            return res.status(409).json({ error: 'That user is already an admin of this group' });
    }

    // only matches while they're a member and not yet an admin, so a double click adds them once
    const updated = normaliseGroup(await groups.findOneAndUpdate(
        { _id: group._id, memberEmails: email, adminEmails: { $ne: email } },
        { $push: { adminEmails: email } }, { returnDocument: 'after' }));
        if (!updated) {
            return res.status(409).json({ error: 'That user is already an admin of this group' });
    }

    await logAudit('Admin Promoted', actor, `Promoted ${email} to admin of "${group.name}"`);
    res.status(200).json(updated);
});

// demote an admin, or step down yourself. never the last admin.
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

    // still a member, just not an admin. the filter only matches while a second admin exists, so
    // two admins demoting each other at the same moment can't leave the group with none.
    const updated = normaliseGroup(await groups.findOneAndUpdate(
        { _id: group._id, adminEmails: email, 'adminEmails.1': { $exists: true } },
        { $pull: { adminEmails: email } }, { returnDocument: 'after' }));
        if (!updated) {
            return res.status(409).json({ error: 'A group must always have at least one admin' });
    }

    await logAudit('Admin Demoted', actor,
        actor === email ? `Stepped down as admin of "${group.name}"` : `Demoted ${email} in "${group.name}"`);
    res.status(200).json(updated);
});


//channels routes

app.get('/channels', async (req, res) => {        // all rooms, or one group's with ?groupId=
    const { groupId } = req.query;

        if (groupId) {
            const id = toObjectId(groupId);
                if (!id) {      // a malformed id can't match anything, so an empty list
                    return res.status(200).json([]);
            }
            return res.status(200).json(await channels.find({ groupId: id }).toArray());
    }
    res.status(200).json(await channels.find().toArray());
});

app.post('/channels', async (req, res) => {       // an admin creates a room directly
    const { groupId } = req.body;
    const name = String(req.body.name ?? '').trim();       // trimmed first, so '   ' counts as missing
    const actor = normaliseEmail(req.body.actorEmail);

        if (!groupId || !name) {
            return res.status(400).json({ error: 'Group id and channel name are required' });
    }
        if (name.length > MAX_NAME) {
            return res.status(400).json({ error: `Room names can be at most ${MAX_NAME} characters` });
    }

    const id = toObjectId(groupId);
    const group = normaliseGroup(id && await groups.findOne({ _id: id }));
        if (!group) {
            return res.status(404).json({ error: 'Group not found' });
    }

    // members propose rooms instead, otherwise the approval step could be skipped
        if (!group.adminEmails.includes(actor)) {
            return res.status(403).json({ error: 'Only an admin of this group can create a room. Propose it instead.' });
    }

    // names are unique within a group, not across groups
    const existingChannel = await channels.findOne({ groupId: id, name }, CASE_INSENSITIVE);
        if (existingChannel) {
            return res.status(409).json({ error: 'That group already has a channel with this name' });
    }

    const newChannel = { groupId: id, name };     // groupId stored as an ObjectId
    await channels.insertOne(newChannel);
    await logAudit('Room Created', actor, `Created room "${newChannel.name}" in "${group.name}"`);
    res.status(201).json(newChannel);
});

// an admin renames a room
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
        if (cleanName.length > MAX_NAME) {
            return res.status(400).json({ error: `Room names can be at most ${MAX_NAME} characters` });
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

app.delete('/channels/:id', async (req, res) => {     // an admin deletes a room
    const channelId = toObjectId(req.params.id);
    const channel = channelId && await channels.findOne({ _id: channelId });

        if (!channel) {
            return res.status(404).json({ error: 'Channel not found' });
    }

    const actor = normaliseEmail(req.query.actorEmail);
    const group = normaliseGroup(await groups.findOne({ _id: channel.groupId }));
        if (!group || !group.adminEmails.includes(actor)) {
            return res.status(403).json({ error: 'Only an admin of this group can delete a room' });
    }

    // messages can't outlive their room
    await deleteMessages({ channelId: channel._id });
    await channels.deleteOne({ _id: channel._id });
    // anyone still in it is taken out, so they can't keep posting into a room that's gone
    await removeFromRooms(room => room.channelId === String(channel._id), 'This room has been deleted');
    await logAudit('Room Deleted', actor, `Deleted room "${channel.name}"`);
    res.status(200).json({ message: 'Channel deleted' });
});


//requests routes
//
// five actions have to be asked for:
//   group-create   user -> super admin, with the group's details up front
//   group-delete   group admin -> super admin
//   channel-create member -> group admin
//   group-join     user -> group admin (too young is rejected automatically)
//   user-ban       group admin reports a user -> super admin bans permanently
// one collection with a type field, since approve/reject work the same for all five.

const SUPER_TYPES = ['group-create', 'group-delete', 'user-ban'];   // the super admin's types, the rest go to group admins

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
                if (!id) {      // same as /channels
                    return res.status(200).json([]);
            }
            query.groupId = id;
    }
        if (requestedBy) {      // the profile page's own requests
            query.requestedBy = normaliseEmail(requestedBy);
    }
        // splits the super admin's queue from a group admin's
        if (scope === 'super') {
            query.type = { $in: SUPER_TYPES };
    }
        if (scope === 'group') {
            query.type = { $nin: SUPER_TYPES };
    }

    res.status(200).json(await requests.find(query).sort({ createdAt: -1 }).toArray());   // newest first
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
        // the super admin only actions requests, so can never approve their own
        if (requesterUser.role === 'super') {
            return res.status(403).json({ error: 'The super admin cannot raise requests, only action them' });
    }

    const targetGroupId = groupId ? toObjectId(groupId) : null;     // null for group-create
    const details = payload ?? {};
    let summary = '';
    let autoRejected = null;      // why a request was refused on the spot, with no admin needed

    // validation per type
    switch (type) {
        case 'group-create': {
            const name = String(details.name ?? '').trim();
                if (!name) {
                    return res.status(400).json({ error: 'Group name is required' });
            }
            const badDetails = groupDetailsProblem(details);
                if (badDetails) {
                    return res.status(400).json({ error: badDetails });
            }
                if (await nameTaken(name)) {
                    return res.status(409).json({ error: 'A group with that name already exists' });
            }
                // or already requested by someone else
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
                if (!group.memberEmails.includes(requester)) {      // members only
                    return res.status(403).json({ error: 'You must be a member of this group to propose a room' });
            }
            const roomName = String(details.name ?? '').trim();
                if (!roomName) {
                    return res.status(400).json({ error: 'Room name is required' });
            }
                if (roomName.length > MAX_NAME) {
                    return res.status(400).json({ error: `Room names can be at most ${MAX_NAME} characters` });
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
                // this request is the "prior report" the spec requires, and only a group admin raises it
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
                // an admin reports people from their own group: its members, or someone they've banned from it
                if (!group.memberEmails.includes(target) && !group.bannedEmails.includes(target)) {
                    return res.status(404).json({ error: 'You can only report someone who is in, or banned from, this group' });
            }
                if (!String(details.reason ?? '').trim()) {
                    return res.status(400).json({ error: 'A reason is required to report a user' });
            }
                // a group's only admin needs a replacement first ('adminEmails.1' missing = one admin)
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

        case 'group-join': {
            const group = normaliseGroup(targetGroupId && await groups.findOne({ _id: targetGroupId }));
                if (!group) {
                    return res.status(404).json({ error: 'Group not found' });
            }
                if (group.memberEmails.includes(requester)) {
                    return res.status(409).json({ error: 'You are already in this group' });
            }
                if (group.bannedEmails.includes(requester)) {
                    return res.status(403).json({ error: 'You are banned from this group' });
            }
                if (await requests.findOne({ status: 'pending', type: 'group-join', groupId: targetGroupId, requestedBy: requester })) {
                    return res.status(409).json({ error: 'You have already asked to join this group' });
            }
            summary = `Join "${group.name}"`;
            // too young, or no date of birth to check: refused straight away rather than waiting for
            // an admin. it's still saved, as rejected with the reason, so it shows on their profile.
            autoRejected = ageProblem(requesterUser, group);
            break;
        }

        default:
            return res.status(400).json({ error: 'Unknown request type' });
    }

    const now = new Date().toISOString();
    const newRequest = {
        type,
        status: autoRejected ? 'rejected' : 'pending',      // -> approved or rejected. no cancelling
        summary,                // the wording every queue shows
        requestedBy: requester,
        groupId: targetGroupId,
        payload: details,
        createdAt: now,
        resolvedAt: autoRejected ? now : '',
        resolvedBy: autoRejected ? 'automatic' : '',
        reason: autoRejected ?? '',     // set on rejection
    };

    await requests.insertOne(newRequest);
    await logAudit('Request Raised', requester, summary);
        if (autoRejected) {
            await logAudit('Request Rejected', 'automatic', `${summary}. Rejected: ${autoRejected}`);
    }
    announceRequestsChanged(targetGroupId);
    // 201 either way, the request was recorded. the client checks status to tell the user which.
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
        // a group admin can't approve their own room proposal
        if (request.requestedBy === actor) {
            return res.status(403).json({ error: 'You cannot approve your own request' });
    }

    const actorUser = await users.findOne({ email: actor });
        if (!actorUser) {
            return res.status(404).json({ error: 'User not found' });
    }

    // nothing is carried out for an account that no longer exists. it can still be rejected.
        if (!(await users.findOne({ email: request.requestedBy }))) {
            return res.status(409).json({ error: 'The user who raised this request no longer has an account. Reject it instead.' });
    }

    // super admin for the system types, a group admin for room proposals
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

    // claimed before anything is carried out. the update only matches while the request is still
    // pending, so a double click, or two admins at once, can't both carry it out: the second gets null.
    const claimed = await requests.findOneAndUpdate(
        { _id: request._id, status: 'pending' },
        { $set: { status: 'approved', resolvedAt: new Date().toISOString(), resolvedBy: actor } },
        { returnDocument: 'after' });
        if (!claimed) {
            return res.status(409).json({ error: 'That request has already been actioned' });
    }

    // puts it back to pending when a re-check below refuses it, so it can still be actioned later
    const release = () => requests.updateOne(
        { _id: request._id }, { $set: { status: 'pending', resolvedAt: '', resolvedBy: '' } });

    // carry the request out
    try {
        switch (request.type) {
            case 'group-create': {
                // re-checked, the name may have been taken while the request waited
                const wantedName = String(request.payload.name ?? '').trim();
                    if (await nameTaken(wantedName)) {
                        await release();
                        return res.status(409).json({ error: 'A group with that name already exists' });
                }
                const created = await createGroupRecord(request.payload, request.requestedBy);
                await logAudit('Group Created', actor, `Approved "${created.name}", ${request.requestedBy} is its first admin`);
                break;
            }

            case 'group-delete': {
                const group = await groups.findOne({ _id: request.groupId });
                    if (!group) {
                        await release();
                        return res.status(404).json({ error: 'Group not found' });
                }
                // same order as DELETE /groups/:id
                const doomed = await channels.find({ groupId: group._id }).toArray();
                await deleteMessages({ channelId: { $in: doomed.map(c => c._id) } });

                await groups.deleteOne({ _id: group._id });
                await channels.deleteMany({ groupId: group._id });
                await removeFromRooms(room => String(room.groupId) === String(group._id), 'This group has been deleted');
                // this request is already marked approved, so only the group's other requests are still pending
                await closePendingRequests({ groupId: group._id }, 'The group was deleted', actor);
                await logAudit('Group Deleted', actor, `Approved deletion of "${group.name}" and its rooms`);
                break;
            }

            case 'channel-create': {
                const roomName = String(request.payload.name).trim();
                    // re-checked, an admin may have made the same room meanwhile
                    if (await channels.findOne({ groupId: request.groupId, name: roomName }, CASE_INSENSITIVE)) {
                        await release();
                        return res.status(409).json({ error: 'That group already has a channel with this name' });
                }
                await channels.insertOne({ groupId: request.groupId, name: roomName });
                await logAudit('Room Created', actor, `Approved room "${roomName}" proposed by ${request.requestedBy}`);
                break;
            }

            case 'group-join': {
                const group = normaliseGroup(await groups.findOne({ _id: request.groupId }));
                    if (!group) {
                        await release();
                        return res.status(404).json({ error: 'Group not found' });
                }
                // re-checked: they may have been banned, or the age limit raised, while it waited
                    if (group.bannedEmails.includes(request.requestedBy)) {
                        await release();
                        return res.status(409).json({ error: 'They have been banned from this group since asking. Reject it instead.' });
                }
                const requester = await users.findOne({ email: request.requestedBy });
                    if (ageProblem(requester, group)) {
                        await release();
                        return res.status(409).json({ error: 'They no longer meet this group\'s age limit. Reject it instead.' });
                }
                // only adds them if they aren't a member already, so they can't be in the list twice
                await groups.updateOne(
                    { _id: group._id, memberEmails: { $ne: request.requestedBy } },
                    { $push: { memberEmails: request.requestedBy } });
                await logAudit('Group Joined', request.requestedBy, `Joined group "${group.name}", approved by ${actor}`);
                break;
            }

            case 'user-ban': {
                const target = normaliseEmail(request.payload.email);
                    // re-checked, they may have become a group's only admin since the report
                    const onlyAdminOf = await groups.findOne({ adminEmails: target, 'adminEmails.1': { $exists: false } });
                    if (onlyAdminOf) {
                        await release();
                        return res.status(409).json({ error: `${target} is the only admin of "${onlyAdminOf.name}". A replacement admin must be assigned before the ban.` });
                }

                // permanent ban: delete the account (and picture), remove from every group,
                // and add the email to the banned list so /register refuses it
                const bannedUser = await users.findOne({ email: target });
                await removeUploadedFile(bannedUser?.avatarUrl);
                await users.deleteOne({ email: target });

                await groups.updateMany(
                    { $or: [{ memberEmails: target }, { adminEmails: target }] },
                    { $pull: { memberEmails: target, adminEmails: target } });
                await removeFromRooms(room => room.email === target, 'Your account has been permanently banned');

                await banned.insertOne({
                    email: target,
                    reason: request.payload.reason ?? '',
                    reportedBy: request.requestedBy,
                    bannedAt: new Date().toISOString(),
                    bannedBy: actor,
                });
                // close their pending requests, e.g. a group-create that would get a deleted admin
                await closePendingRequests({ requestedBy: target }, 'The requester was permanently banned', actor);
                await logAudit('User Banned', actor, `Permanently banned ${target}. Reason: ${request.payload.reason ?? 'no reason given'}`);
                break;
            }
        }
    } catch (err) {
        await release();    // a failure part way through shouldn't leave it marked approved
        throw err;          // express 5 passes it on to the error handler
    }

    announceRequestsChanged(request.groupId);
    res.status(200).json(claimed);
});

app.post('/requests/:id/reject', async (req, res) => {
    const actor = normaliseEmail(req.body.actorEmail);
    const reason = String(req.body.reason ?? '').trim();

        // the spec requires a reason
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

    // same authority check as approve
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

    // only while it's still pending, the same claim as approve, so an approve and a reject sent at
    // the same moment can't both succeed
    const updated = await requests.findOneAndUpdate(
        { _id: request._id, status: 'pending' },
        { $set: {
            status: 'rejected',
            reason,                 // shown on the requester's profile
            resolvedAt: new Date().toISOString(),
            resolvedBy: actor,
        } },
        { returnDocument: 'after' });
        if (!updated) {
            return res.status(409).json({ error: 'That request has already been actioned' });
    }

    await logAudit('Request Rejected', actor, `${request.summary}. Rejected: ${reason}`);
    announceRequestsChanged(request.groupId);
    res.status(200).json(updated);
});


//bans and audit routes

app.get('/bans', async (req, res) => {        // every permanently banned account
    res.status(200).json(await banned.find().toArray());
});

// the audit log, newest first, optionally filtered by type, AUDIT_PAGE entries at a time
const AUDIT_PAGE = 100;
app.get('/audit', async (req, res) => {
    const { type } = req.query;
    const query = type ? { type } : {};

    // a page at a time, so a log that grows for years isn't sent in one go. `skip` is how many the
    // client already has, and the "Show older" button asks for the next page.
    const limit = Math.min(Number(req.query.limit) || AUDIT_PAGE, 500);
    const skip = Math.max(Number(req.query.skip) || 0, 0);

    res.status(200).json(await audit.find(query).sort({ at: -1 }).skip(skip).limit(limit).toArray());
});

// the types actually in the log, for the filter dropdown
app.get('/audit/types', async (req, res) => {
    const types = await audit.distinct('type');
    res.status(200).json(types.sort());
});


//image upload route
//
// an image message is two steps: upload the file here over http and get a path back, then send
// that path in a socket message. multer handles the size limit, type check and streaming to disk.

// allowed types. the extension comes from this map, never the filename. no svg, it can carry script.
const IMAGE_TYPES = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
};
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;     // 5 MB

const upload = multer({
    storage: multer.diskStorage({
        destination: UPLOAD_DIR,
        // random name: no overwrites, and no ../ escaping the folder
        filename: (req, file, cb) => cb(null, crypto.randomUUID() + IMAGE_TYPES[file.mimetype]),
    }),
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
    // false skips the file, so req.file is undefined and the route answers 400
    fileFilter: (req, file, cb) => cb(null, Boolean(IMAGE_TYPES[file.mimetype])),
});

// the only image path a message may carry: one this server handed out
const IMAGE_PATH = /^\/uploads\/[0-9a-f-]{36}\.(png|jpg|gif|webp)$/;

app.post('/uploads', (req, res, next) => {
    // called by hand so multer's errors come back here as json instead of a 500
    upload.single('image')(req, res, async err => {
        try {
            if (err) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(413).json({ error: 'Images must be 5 MB or smaller' });   // 413 = too large
                }
                return res.status(400).json({ error: 'Could not read that upload' });
            }
            if (!req.file) {
                return res.status(400).json({ error: 'Choose a PNG, JPEG, GIF or WebP image' });
            }

            // members only. the file is already written, so a refusal deletes it.
            const email = normaliseEmail(req.body.email);
            const channelId = toObjectId(req.body.channelId);
            const channel = channelId && await channels.findOne({ _id: channelId });
            const group = channel && normaliseGroup(await groups.findOne({ _id: channel.groupId }));
            if (!group || !group.memberEmails.includes(email)) {
                await fs.promises.rm(req.file.path, { force: true });
                return res.status(403).json({ error: 'You are not a member of this group' });
            }

            // relative path, the client adds the api address
            res.status(201).json({ imageUrl: `/uploads/${req.file.filename}` });
        } catch (e) {
            next(e);
        }
    });
});


// profile pictures: same multer setup as chat images, path stored in the user's avatarUrl

// multer as a promise, so the route can be a normal async handler
function readImage(req, res) {
    return new Promise(resolve => upload.single('image')(req, res, err => resolve(err ?? null)));
}

app.post('/users/:email/avatar', async (req, res) => {
    const email = normaliseEmail(req.params.email);

    const err = await readImage(req, res);
        if (err) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({ error: 'Images must be 5 MB or smaller' });
        }
            return res.status(400).json({ error: 'Could not read that upload' });
    }
        if (!req.file) {
            return res.status(400).json({ error: 'Choose a PNG, JPEG, GIF or WebP image' });
    }

    // own picture only. actorEmail must come before the file in the form to be in req.body.
        if (normaliseEmail(req.body.actorEmail) !== email) {
            await fs.promises.rm(req.file.path, { force: true });
            return res.status(403).json({ error: 'You can only change your own profile picture' });
    }

    const user = await users.findOne({ email });
        if (!user) {
            await fs.promises.rm(req.file.path, { force: true });
            return res.status(404).json({ error: 'User not found' });
    }

    const updated = await users.findOneAndUpdate(
        { email }, { $set: { avatarUrl: `/uploads/${req.file.filename}` } }, { returnDocument: 'after' });

    // old file deleted after the save, so a failed save never points at a missing file
    await removeUploadedFile(user.avatarUrl);

    await logAudit('Profile Picture Changed', email, 'Uploaded a new profile picture');
    res.status(200).json(publicUser(updated));
});

// back to the initial letter, and the file is deleted
app.delete('/users/:email/avatar', async (req, res) => {
    const email = normaliseEmail(req.params.email);

        if (normaliseEmail(req.query.actorEmail) !== email) {
            return res.status(403).json({ error: 'You can only change your own profile picture' });
    }

    const user = await users.findOne({ email });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
    }

    const updated = await users.findOneAndUpdate(
        { email }, { $set: { avatarUrl: '' } }, { returnDocument: 'after' });
    await removeUploadedFile(user.avatarUrl);

    await logAudit('Profile Picture Removed', email, 'Removed their profile picture');
    res.status(200).json(publicUser(updated));
});


// express 5 passes a rejected promise from an async route here, so a failed mongo call gets a
// 500 instead of hanging. four arguments marks it as the error handler.
app.use((err, req, res, next) => {
    // a body that isn't valid JSON: express.json() throws before any route runs. that's the
    // client's mistake, so a 400, not a 500
    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({ error: 'The request body is not valid JSON' });
    }
    // mongo's duplicate key error from a unique index: two requests got past a route's own check
    // at the same moment (e.g. registering one email twice at once) and the index stopped the second
    if (err.code === 11000) {
        return res.status(409).json({ error: 'That already exists' });
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server' });
});

// how many past messages a joiner gets
const HISTORY_LIMIT = 50;

function registerSocketHandlers() {
  io.on('connection', socket => {
    // the room this socket is in, so disconnect can clean up directly
    let joined = null;      // { channelId, groupId, email }

    // so removeFromRooms() can see which room this socket is in, and take it out
    socket.data.room = () => joined;
    socket.data.leave = () => leaveCurrentRoom();

    socket.on('joinRoom', async ({ channelId, email }, ack) => {
      try {
        const cleanEmail = normaliseEmail(email);
        const id = toObjectId(channelId);
        if (!id || !cleanEmail) {
          return ack?.({ error: 'Bad room or user' });
        }

        const channel = await channels.findOne({ _id: id });
        if (!channel) {
          return ack?.({ error: 'Room not found' });
        }

        // members of the group only
        const group = normaliseGroup(await groups.findOne({ _id: channel.groupId }));
        if (!group || !group.memberEmails.includes(cleanEmail)) {
          return ack?.({ error: 'You are not a member of this group' });
        }

        // leave the previous room first, so you're never listed in two
        if (joined) {
          await leaveCurrentRoom();
        }

        const roomKey = String(id);
        socket.join(roomKey);
        joined = { channelId: roomKey, groupId: group._id, email: cleanEmail };

        if (!presence.has(roomKey)) {
          presence.set(roomKey, new Map());
        }
        presence.get(roomKey).set(socket.id, cleanEmail);

        // the newest 50, reversed into reading order (oldest first). one extra is fetched only to
        // know whether older messages exist, so the page can offer to load them
        const newest = await messages.find({ channelId: id })
          .sort({ at: -1 }).limit(HISTORY_LIMIT + 1).toArray();
        const history = newest.slice(0, HISTORY_LIMIT).reverse();

        // history and presence go only to the joiner
        ack?.({ history, present: peopleIn(roomKey), more: newest.length > HISTORY_LIMIT });

        // socket.to excludes the joiner, io.to includes everyone
        socket.to(roomKey).emit('userJoined', { email: cleanEmail });
        io.to(roomKey).emit('presence', peopleIn(roomKey));
      } catch (err) {
        console.error(err);
        ack?.({ error: 'Could not join the room' });
      }
    });

    socket.on('sendMessage', async ({ body, imageUrl }, ack) => {
      try {
        // the sender comes from the join, never the payload, so it can't be spoofed
        if (!joined) {
          return ack?.({ error: 'Join a room first' });
        }

        // re-checked every send, in case they were removed or banned while in the room
        const group = await groups.findOne({ _id: joined.groupId });
        if (!group || !group.memberEmails.includes(joined.email)) {
          await leaveCurrentRoom();
          return ack?.({ error: 'You are no longer a member of this group' });
        }
        const text = String(body ?? '').trim();
        const image = String(imageUrl ?? '');

        // an image must be one /uploads handed out and still on disk, not any outside url
        if (image) {
          const onDisk = await fs.promises.access(path.join(UPLOAD_DIR, path.basename(image)))
            .then(() => true, () => false);
          if (!IMAGE_PATH.test(image) || !onDisk) {
            return ack?.({ error: 'That image could not be found. Try uploading it again.' });
          }
        }

        // text, an image, or both
        if (!text && !image) {
          return ack?.({ error: 'Message cannot be empty' });
        }
        if (text.length > MAX_MESSAGE) {
          return ack?.({ error: `Messages can be at most ${MAX_MESSAGE} characters` });
        }

        const message = {
          channelId: new ObjectId(joined.channelId),
          sender: joined.email,
          body: text,
          imageUrl: image,                     // '' for text only
          at: new Date().toISOString(),
        };
        await messages.insertOne(message);     // sets _id before the broadcast

        io.to(joined.channelId).emit('newMessage', message);   // io.to: the sender gets it too
        ack?.({ ok: true });
      } catch (err) {
        console.error(err);
        ack?.({ error: 'Could not send that message' });
      }
    });

    // the 50 messages before the oldest one the page has, for "Load older messages". a room's
    // history can be any length, so it's sent a page at a time rather than all at once
    socket.on('loadOlder', async ({ before }, ack) => {
      try {
        if (!joined) {
          return ack?.({ error: 'Join a room first' });
        }
        const beforeId = toObjectId(before);
        if (!beforeId) {
          return ack?.({ error: 'Bad message id' });
        }
        // _id order is the order they were stored in, so "older" is a smaller _id
        const page = await messages.find({ channelId: new ObjectId(joined.channelId), _id: { $lt: beforeId } })
          .sort({ _id: -1 }).limit(HISTORY_LIMIT + 1).toArray();
        ack?.({ messages: page.slice(0, HISTORY_LIMIT).reverse(), more: page.length > HISTORY_LIMIT });
      } catch (err) {
        console.error(err);
        ack?.({ error: 'Could not load older messages' });
      }
    });

    // "x is typing", to everyone else in the room. not stored, and the client sends it at most
    // every couple of seconds while someone types
    socket.on('typing', () => {
      if (joined) {
        socket.to(joined.channelId).emit('typing', { email: joined.email });
      }
    });

    socket.on('leaveRoom', () => leaveCurrentRoom());
    socket.on('disconnect', () => leaveCurrentRoom());   // closing the tab counts as leaving

    async function leaveCurrentRoom() {
      if (!joined) {
        return;
      }
      const { channelId, email } = joined;
      joined = null;

      const room = presence.get(channelId);
      if (room) {
        room.delete(socket.id);
        if (room.size === 0) {
          presence.delete(channelId);   // drop empty rooms
        }
      }

      socket.leave(channelId);
      socket.to(channelId).emit('userLeft', { email });
      io.to(channelId).emit('presence', peopleIn(channelId));
    }
  });
}



const PORT = 3000;

// express and socket.io share one http server, so it's created here instead of app.listen()
const server = http.createServer(app);

// the websocket handshake needs its own cors config, app.use(cors()) only covers rest routes
const io = new Server(server, {
  cors: { origin: 'http://localhost:4200', methods: ['GET', 'POST'] },
});

// who is in which room: channelId -> Map(socket.id -> email). in memory because presence is
// temporary, a restart should empty it. keyed by socket so two tabs are two entries.
const presence = new Map();

function peopleIn(channelId) {
  const room = presence.get(channelId);
  return room ? [...new Set(room.values())] : [];   // Set removes the two-tab duplicate
}

// takes everyone whose room matches out of it, and tells them why. used when someone is removed or
// banned, or a room or group is deleted. without it, a person removed from a group while sitting in
// one of its rooms kept receiving its messages until they left the page.
// `match` is given the { channelId, groupId, email } of each connected socket's room.
async function removeFromRooms(match, reason) {
  for (const socket of io.sockets.sockets.values()) {
    const room = socket.data.room?.();
    if (room && match(room)) {
      await socket.data.leave();
      socket.emit('removedFromRoom', { reason });
    }
  }
}

// the database enforces these itself, on top of each route's own check: one account per email, a
// banned email listed once, and group names unique ignoring case. the rest make the common reads
// fast: the request queues and audit log filter then sort newest first, room history oldest first.
async function ensureIndexes() {
  const wanted = [
    [users, { email: 1 }, { unique: true }],
    [banned, { email: 1 }, { unique: true }],
    [groups, { name: 1 }, { unique: true, ...CASE_INSENSITIVE }],
    [requests, { status: 1, createdAt: -1 }, {}],
    [audit, { type: 1, at: -1 }, {}],
    [messages, { channelId: 1, at: 1 }, {}],
  ];
  for (const [collection, keys, options] of wanted) {
    try {
      await collection.createIndex(keys, options);      // does nothing if it already exists
    } catch (err) {
      // existing data that already breaks a unique rule stops that index being built. the server
      // still starts, and the routes' own checks still apply.
      console.warn(`Could not create an index on ${collection.collectionName}: ${err.message}`);
    }
  }
}

// port 0 (any free port) is used by the tests. returns the mongo client so the caller can close it.
async function start(port = PORT) {
  const client = new MongoClient(MONGO_URL);
  await client.connect();

  const db = client.db(DB_NAME);
  users = db.collection('users');
  groups = db.collection('groups');
  channels = db.collection('channels');
  requests = db.collection('requests');
  audit = db.collection('audit');
  banned = db.collection('banned');
  messages = db.collection('messages');

  await ensureIndexes();

  registerSocketHandlers();      // after the collections exist

  console.log(`Connected to MongoDB at ${MONGO_URL}/${DB_NAME}`);

  // resolves once the server is actually listening
  await new Promise(resolve => server.listen(port, resolve));    // server.listen, since io is attached to it
  console.log(`Server listening on port ${server.address().port}`);
  return client;
}


// only start when run directly (`npm start`). the tests require() this file and start it themselves.
if (require.main === module) {
  start().catch(err => {      // no mongo, nothing works, so exit
      console.error('Failed to start server:', err);
      process.exit(1);
  });
}

module.exports = { app, server, io, start, UPLOAD_DIR };
