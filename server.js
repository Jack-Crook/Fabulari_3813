const express = require('express');
const cors = require('cors');// Angular (localhost:4200) and Express (localhost:3000) are different origins,
                            // so without this the browser blocks Angular's requests to this API by default.
                    // cors() adds the Access-Control-Allow-Origin header to responses so the browser allows it.

const app = express();

app.use(cors());            // allow requests from other origins (Angular on :4200)
app.use(express.json());    // parse JSON request bodies into req.body

app.get('/', (req, res) => {            // test route to confirm the server is alive
  res.send('Fabulari API running');
});

const fs = require('fs');
const path = require('path');

const usersPath = path.join(__dirname, 'data', 'users.json');       // location of the users data file
const groupsPath = path.join(__dirname, 'data', 'groups.json');     // one file per type of data, so it maps straight onto one mongo collection per type in phase 2
const channelsPath = path.join(__dirname, 'data', 'channels.json');
const requestsPath = path.join(__dirname, 'data', 'requests.json'); // every pending/approved/rejected request in the system
const auditPath = path.join(__dirname, 'data', 'audit.json');       // the super admin's audit log
const bannedPath = path.join(__dirname, 'data', 'banned.json');     // permanently banned emails, kept after the account is deleted so they can never re-register


// every route below does the same three things: read a json file, turn it into a JS array, then write it back.
// these helpers do that in one place so the same fs.readFileSync/JSON.parse pair isn't copy pasted into every route.
function readData(filePath) {
  if (!fs.existsSync(filePath)) {   // if the file hasn't been created yet, start from an empty list instead of crashing the server
    return [];
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeData(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));    // null, 2 keeps the saved json indented so the file is still readable by hand
}

// ids only have to be unique inside this prototype. Date.now() on its own collided when two
// records were made in the same millisecond, so a short random suffix is added on the end.
// phase 2 drops this because mongo generates _id itself.
function makeId(prefix) {
  return prefix + Date.now() + Math.random().toString(36).slice(2, 6);
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

// the password never leaves the server. every route that sends a user back sends this instead
// of the raw record, so the stored password can't be read out of an API response.
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
// the only way a log like this stays complete.
function logAudit(type, actor, detail) {
  const entries = readData(auditPath);
  entries.push({
    id: makeId('a'),
    at: new Date().toISOString(),   // stored as ISO so string sorting and date sorting agree
    type,
    actor,
    detail,
  });
  writeData(auditPath, entries);
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

// group creation happens from two places — the direct POST /groups route and approving a
// group-create request — so the record is built in one place rather than written out twice.
function createGroupRecord(groups, { name, description, ageLimit, theme }, creatorEmail) {
  const newGroup = {
    id: makeId('g'),
    name: String(name).trim(),
    description: description ?? '',
    ageLimit: Number(ageLimit) || 0,  // 0 means no age limit. the spec puts the limit on the group, and it covers every channel inside it
    theme: theme ?? '#5FA8D3',        // the group's colour, which carries through to its chat rooms
    adminEmails: [creatorEmail],      // the spec says a group must always have at least one admin, so whoever asked for it becomes the first one
    memberEmails: [creatorEmail],     // that admin is a member of the group as well
    bannedEmails: [],                 // group level bans. the account still exists, they just can't be in this group
  };
  groups.push(newGroup);
  return newGroup;
}

// older records in groups.json were written before bannedEmails existed, so reading one back
// gives undefined and .includes() throws. every route reads groups through here instead of
// readData directly, so the gap is filled in one place rather than per route.
function readGroups() {
  return readData(groupsPath).map(group => {
    group.bannedEmails = group.bannedEmails ?? [];
    return group;
  });
}


//register route
app.post('/register', (req, res) => {       // handles new user signups
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

  const users = readData(usersPath);// read the users.json file and parse it into a real JS array so it can be searched and pushed onto below

  const existingUser = users.find(user => user.email === cleanEmail);        // check if email is already registered
    if (existingUser) {
        return res.status(409).json({error: 'Email is already registered'});        //
    }

    // a system wide ban is permanent — the spec says the email can never be reused, so the
    // banned list is checked here rather than only at login. deleting the account isn't enough
    // on its own, because nothing would stop them signing up again with the same address.
    const banned = readData(bannedPath).find(b => b.email === cleanEmail);
    if (banned) {
        return res.status(403).json({ error: 'This email is permanently banned and cannot be reused' });
    }

    // bootstrap: the spec says exactly one super admin always exists, and nobody can create
    // that account through the UI. rather than editing users.json by hand, the very first
    // account to register on an empty system becomes it. every account after that is a normal
    // user, so this can only ever happen once.
    const role = users.length === 0 ? 'super' : 'user';

    const newUser = {
        email: cleanEmail,
        password,
        role,
        username: (username ?? '').trim() || cleanEmail.split('@')[0],   // fall back to the part before the @ so nobody is nameless
        dob: dob ?? '',        // optional at signup, but needed before joining an age restricted group
        bio: '',
        createdAt: new Date().toISOString(),
    };

    users.push(newUser);
    writeData(usersPath, users);
    logAudit('User Registered', cleanEmail, role === 'super'
        ? 'First account on the system, promoted to super admin'
        : 'Self registered');

    // the client shows a different message for the bootstrap case, so the role goes back too
    res.status(201).json({ message: 'User registered successfully', email: cleanEmail, role });
});

//login route
app.post('/login', (req, res) => {
    const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });      // 400 = Bad Request, it tells the client (Angular) it sent invalid input,
    }
    const cleanEmail = normaliseEmail(email);       // tidied the same way as register so a stored email always matches a typed one

    const users = readData(usersPath); // read and parse the current users list, same as in /register

    const user = users.find(u => u.email === cleanEmail); // look for a user whose email matches the one submitted; undefined if none found

        if (!user || user.password !== password) {
            return res.status(401).json({ error: 'Invalid email or password' });
    }
    // role goes back too so Angular knows which pages to offer, and the profile fields go with
    // it so the profile page has something to show before it fetches anything
    res.status(200).json({ message: 'Login successful', ...publicUser(user) });
});


//users routes

app.get('/users', (req, res) => {       // every registered account, for the super admin's members panel
    res.status(200).json(readData(usersPath).map(publicUser));      // map(publicUser) strips the password off every record
});

app.get('/users/:email', (req, res) => {        // one account, used by the profile page to load fresh values rather than trusting localStorage
    const email = normaliseEmail(req.params.email);
    const user = readData(usersPath).find(u => u.email === email);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
    }
    res.status(200).json(publicUser(user));
});

// the spec says a user can edit every profile field except their email, because email is the
// unique identifier for the account. role isn't editable either — nobody can promote themself
// to super admin by PUTing their own profile.
app.put('/users/:email', (req, res) => {
    const email = normaliseEmail(req.params.email);
    const { username, dob, bio, password } = req.body;

    const users = readData(usersPath);
    const user = users.find(u => u.email === email);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
    }

        if (username !== undefined) {
            if (!String(username).trim()) {
                return res.status(400).json({ error: 'Username cannot be empty' });
        }
            user.username = String(username).trim();
    }

        if (dob !== undefined) {
            // an empty string is allowed, it means "clearing the date of birth", but a value
            // that's there has to actually be a date or the age check can't use it
            if (dob && ageFrom(dob) === null) {
                return res.status(400).json({ error: 'That is not a valid date of birth' });
        }
            user.dob = dob;
    }

        if (bio !== undefined) {
            user.bio = String(bio);
    }

        if (password !== undefined) {       // changing the password is part of editing the profile
            if (String(password).length < 6) {
                return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }
            user.password = password;
    }

    writeData(usersPath, users);
    logAudit('Profile Updated', email, 'Edited their own profile');
    res.status(200).json(publicUser(user));     // send the saved values back so the client shows what's actually stored
});


//groups routes

app.get('/groups', (req, res) => {      // send back every group, the dashboard uses this for both My Groups and Discover
    res.status(200).json(readGroups());
});

app.post('/groups', (req, res) => {     // creates a group
    const { name, description, ageLimit, theme, creatorEmail } = req.body;

        if (!name || !creatorEmail) {       // a group with no name, or with nobody to admin it, isn't valid
            return res.status(400).json({ error: 'Group name and creator email are required' });
    }

    const groups = readGroups();

    const existingGroup = groups.find(g => g.name.toLowerCase() === String(name).trim().toLowerCase());  // stop two groups ending up with the same name
        if (existingGroup) {
            return res.status(409).json({ error: 'A group with that name already exists' });
    }

    const creator = normaliseEmail(creatorEmail);

    const users = readData(usersPath);
    const creatorUser = users.find(u => u.email === creator);
        if (!creatorUser) {     // same rule as adding a member, a group can't be owned by an email that was never registered
            return res.status(404).json({ error: 'User not found' });
    }
        if (creatorUser.role === 'super') {
            return res.status(409).json({ error: 'The super admin cannot create or admin a group' });
    }

    const newGroup = createGroupRecord(groups, { name, description, ageLimit, theme }, creator);
    writeData(groupsPath, groups);
    logAudit('Group Created', creator, `Created group "${newGroup.name}"`);
    res.status(201).json(newGroup);
});

// a group admin can change the name, description, theme colour and age limit at any time with
// no request needed — the spec is explicit that only creating and deleting a group need the
// super admin. actorEmail is in the body so the server can check they really are an admin here.
app.patch('/groups/:id', (req, res) => {
    const { name, description, ageLimit, theme, actorEmail } = req.body;
    const actor = normaliseEmail(actorEmail);

    const groups = readGroups();
    const group = groups.find(g => g.id === req.params.id);
        if (!group) {
            return res.status(404).json({ error: 'Group not found' });
    }
        if (!group.adminEmails.includes(actor)) {
            return res.status(403).json({ error: 'Only an admin of this group can edit it' });   // 403 = you're logged in, you just aren't allowed to do this
    }

        if (name !== undefined) {
            const cleanName = String(name).trim();
                if (!cleanName) {
                    return res.status(400).json({ error: 'Group name cannot be empty' });
            }
            // the same uniqueness rule as creation, minus this group itself, otherwise saving
            // the form without touching the name would collide with its own record
            const clash = groups.find(g => g.id !== group.id && g.name.toLowerCase() === cleanName.toLowerCase());
                if (clash) {
                    return res.status(409).json({ error: 'A group with that name already exists' });
            }
            group.name = cleanName;
    }

        if (description !== undefined) {
            group.description = String(description);
    }
        if (theme !== undefined) {
            group.theme = theme;
    }

    let booted = [];
        if (ageLimit !== undefined) {
            const newLimit = Number(ageLimit) || 0;
            const raising = newLimit > (group.ageLimit ?? 0);
            group.ageLimit = newLimit;

            // the spec says raising the age limit automatically removes members who no longer
            // meet it. only on a raise — lowering it can't make anyone ineligible.
                if (raising) {
                    const users = readData(usersPath);
                    booted = group.memberEmails.filter(email => {
                        if (group.adminEmails.includes(email)) {
                            return false;       // an admin isn't booted, that could empty adminEmails and break the group
                        }
                        const member = users.find(u => u.email === email);
                        return !member || ageProblem(member, group) !== null;
                    });
                    group.memberEmails = group.memberEmails.filter(email => !booted.includes(email));
            }
    }

    writeData(groupsPath, groups);
    logAudit('Group Edited', actor, `Edited group "${group.name}"`
        + (booted.length ? `, removed ${booted.length} member(s) under the new age limit` : ''));
    res.status(200).json({ group, booted });   // booted goes back so the UI can say who was removed
});

// deleting a group is only reachable through an approved group-delete request, so this route
// takes the super admin's email and checks it rather than trusting the caller.
app.delete('/groups/:id', (req, res) => {
    const actor = normaliseEmail(req.body?.actorEmail ?? req.query.actorEmail);

    const users = readData(usersPath);
    const actorUser = users.find(u => u.email === actor);
        if (!actorUser || actorUser.role !== 'super') {
            return res.status(403).json({ error: 'Only the super admin can delete a group' });
    }

    const groups = readGroups();
    const group = groups.find(g => g.id === req.params.id);
        if (!group) {
            return res.status(404).json({ error: 'Group not found' });
    }

    writeData(groupsPath, groups.filter(g => g.id !== group.id));
    // a channel can't exist without its group, so its rooms go with it rather than being left
    // behind pointing at a groupId that no longer resolves
    writeData(channelsPath, readData(channelsPath).filter(c => c.groupId !== group.id));
    logAudit('Group Deleted', actor, `Deleted group "${group.name}" and its rooms`);
    res.status(200).json({ message: 'Group deleted' });
});

app.post('/groups/:id/members', (req, res) => {     // assigns an existing user to an existing group
    const email = normaliseEmail(req.body.email);

        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
    }

    const users = readData(usersPath);
    const user = users.find(u => u.email === email);          // was: if (!users.find(...))
        if (!user) {                        // don't let a group hold an email that was never registered
            return res.status(404).json({ error: 'User not found' });
    }

    const groups = readGroups();
    const group = groups.find(g => g.id === req.params.id);     // :id in the route path comes through as req.params.id
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


    group.memberEmails.push(email);     // group is a reference into the groups array, so pushing here changes the array that gets written below
    writeData(groupsPath, groups);
    logAudit('Group Joined', email, `Joined group "${group.name}"`);
    res.status(200).json(group);
});

app.delete('/groups/:id/members/:email', (req, res) => {    // removes a user from a group, this is the group level ban/leave, not a system wide delete
    const email = normaliseEmail(req.params.email);

    const groups = readGroups();
    const group = groups.find(g => g.id === req.params.id);
        if (!group) {
            return res.status(404).json({ error: 'Group not found' });
    }

        if (group.adminEmails.includes(email) && group.adminEmails.length === 1) {   // a group always needs at least one admin left behind
            return res.status(409).json({ error: 'Cannot remove the only admin of this group' });
    }

    group.memberEmails = group.memberEmails.filter(m => m !== email);   // filter keeps everyone except the removed email
    group.adminEmails = group.adminEmails.filter(a => a !== email);     // if they were an admin as well, drop them from that list too
    writeData(groupsPath, groups);
    logAudit('Member Removed', normaliseEmail(req.query.actorEmail) || email, `${email} left or was removed from "${group.name}"`);
    res.status(200).json(group);
});

// group level ban. the account still exists and they keep every other group — this only stops
// them being in this one, and unlike a system wide ban it can be lifted.
app.post('/groups/:id/bans', (req, res) => {
    const email = normaliseEmail(req.body.email);
    const actor = normaliseEmail(req.body.actorEmail);
    const reason = String(req.body.reason ?? '').trim();

    const groups = readGroups();
    const group = groups.find(g => g.id === req.params.id);
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

    group.memberEmails = group.memberEmails.filter(m => m !== email);
    group.adminEmails = group.adminEmails.filter(a => a !== email);
    group.bannedEmails.push(email);
    writeData(groupsPath, groups);
    logAudit('Group Ban', actor, `Banned ${email} from "${group.name}"${reason ? ` — ${reason}` : ''}`);
    res.status(200).json(group);
});

app.delete('/groups/:id/bans/:email', (req, res) => {   // lifts a group level ban, which the spec allows because only system wide bans are permanent
    const email = normaliseEmail(req.params.email);
    const actor = normaliseEmail(req.query.actorEmail);

    const groups = readGroups();
    const group = groups.find(g => g.id === req.params.id);
        if (!group) {
            return res.status(404).json({ error: 'Group not found' });
    }

        if (!group.adminEmails.includes(actor)) {
            return res.status(403).json({ error: 'Only an admin of this group can lift a ban' });
    }

    group.bannedEmails = group.bannedEmails.filter(b => b !== email);
    writeData(groupsPath, groups);
    logAudit('Group Ban Lifted', actor, `Lifted the ban on ${email} in "${group.name}"`);
    res.status(200).json(group);
});

// promotion. the spec says an existing group admin can promote any member of that group, and
// there's no limit on how many admins a group has or how many groups you can admin.
app.post('/groups/:id/admins', (req, res) => {
    const email = normaliseEmail(req.body.email);
    const actor = normaliseEmail(req.body.actorEmail);

    const groups = readGroups();
    const group = groups.find(g => g.id === req.params.id);
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

    group.adminEmails.push(email);
    writeData(groupsPath, groups);
    logAudit('Admin Promoted', actor, `Promoted ${email} to admin of "${group.name}"`);
    res.status(200).json(group);
});

// demotion, including an admin stepping down themself. either way the rule is the same: the
// group can never be left with no admin, so the last one can't be demoted.
app.delete('/groups/:id/admins/:email', (req, res) => {
    const email = normaliseEmail(req.params.email);
    const actor = normaliseEmail(req.query.actorEmail);

    const groups = readGroups();
    const group = groups.find(g => g.id === req.params.id);
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

    group.adminEmails = group.adminEmails.filter(a => a !== email);      // they stay a member, they just stop being an admin
    writeData(groupsPath, groups);
    logAudit('Admin Demoted', actor,
        actor === email ? `Stepped down as admin of "${group.name}"` : `Demoted ${email} in "${group.name}"`);
    res.status(200).json(group);
});


//channels routes

app.get('/channels', (req, res) => {        // /channels lists them all, /channels?groupId=g1 lists just one group's channels
    const channels = readData(channelsPath);
    const { groupId } = req.query;          // anything after the ? in the url ends up in req.query

        if (groupId) {
            return res.status(200).json(channels.filter(c => c.groupId === groupId));
    }
    res.status(200).json(channels);
});

app.post('/channels', (req, res) => {       // creates a channel inside a group
    const { groupId, name } = req.body;

        if (!groupId || !name) {
            return res.status(400).json({ error: 'Group id and channel name are required' });
    }

    const groups = readGroups();
    const group = groups.find(g => g.id === groupId);
        if (!group) {      // a channel can't exist on its own, it has to belong to a real group
            return res.status(404).json({ error: 'Group not found' });
    }

    const channels = readData(channelsPath);

    const existingChannel = channels.find(c => c.groupId === groupId && c.name.toLowerCase() === String(name).trim().toLowerCase());
        if (existingChannel) {      // two channels can share a name across different groups, just not inside the same one
            return res.status(409).json({ error: 'That group already has a channel with this name' });
    }

    const newChannel = { id: makeId('c'), groupId, name: String(name).trim() };
    channels.push(newChannel);
    writeData(channelsPath, channels);
    logAudit('Room Created', normaliseEmail(req.body.actorEmail) || 'system', `Created room "${newChannel.name}" in "${group.name}"`);
    res.status(201).json(newChannel);
});

// the spec says a group admin can rename a room they created, to fix a typo for instance
app.patch('/channels/:id', (req, res) => {
    const { name, actorEmail } = req.body;
    const actor = normaliseEmail(actorEmail);

    const channels = readData(channelsPath);
    const channel = channels.find(c => c.id === req.params.id);
        if (!channel) {
            return res.status(404).json({ error: 'Channel not found' });
    }

    const group = readGroups().find(g => g.id === channel.groupId);
        if (!group || !group.adminEmails.includes(actor)) {
            return res.status(403).json({ error: 'Only an admin of this group can rename a room' });
    }

    const cleanName = String(name ?? '').trim();
        if (!cleanName) {
            return res.status(400).json({ error: 'Room name cannot be empty' });
    }
    const clash = channels.find(c => c.id !== channel.id && c.groupId === channel.groupId
        && c.name.toLowerCase() === cleanName.toLowerCase());
        if (clash) {
            return res.status(409).json({ error: 'That group already has a channel with this name' });
    }

    const oldName = channel.name;
    channel.name = cleanName;
    writeData(channelsPath, channels);
    logAudit('Room Renamed', actor, `Renamed "${oldName}" to "${cleanName}" in "${group.name}"`);
    res.status(200).json(channel);
});

app.delete('/channels/:id', (req, res) => {     // group admins can delete a room they made, so this removes one by id
    const channels = readData(channelsPath);
    const channel = channels.find(c => c.id === req.params.id);

        if (!channel) {     // nothing matched that id
            return res.status(404).json({ error: 'Channel not found' });
    }

    writeData(channelsPath, channels.filter(c => c.id !== channel.id));
    logAudit('Room Deleted', normaliseEmail(req.query.actorEmail) || 'system', `Deleted room "${channel.name}"`);
    res.status(200).json({ message: 'Channel deleted' });
});


//requests routes
//
// four things in the spec can't be done directly and have to be asked for:
//   group-create   a user asks the super admin for a new group, supplying the details up front
//   group-delete   a group admin asks the super admin to delete their group (or disband it)
//   channel-create a member proposes a room, the group admin approves or rejects it
//   user-ban       a group admin reports a user, the super admin actions the permanent ban
// they all live in one requests.json with a type field, because the approve/reject/reason
// mechanics are identical and only the action taken on approval differs.

const SUPER_TYPES = ['group-create', 'group-delete', 'user-ban'];   // these go to the super admin, the rest go to the group's admins

app.get('/requests', (req, res) => {
    const { status, type, groupId, requestedBy, scope } = req.query;
    let requests = readData(requestsPath);

        if (status) {
            requests = requests.filter(r => r.status === status);
    }
        if (type) {
            requests = requests.filter(r => r.type === type);
    }
        if (groupId) {
            requests = requests.filter(r => r.groupId === groupId);
    }
        if (requestedBy) {      // the profile page uses this so a user sees their own pending and rejected requests
            requests = requests.filter(r => r.requestedBy === normaliseEmail(requestedBy));
    }
        // scope splits the super admin's queue from a group admin's queue without the client
        // having to know which types belong where
        if (scope === 'super') {
            requests = requests.filter(r => SUPER_TYPES.includes(r.type));
    }
        if (scope === 'group') {
            requests = requests.filter(r => !SUPER_TYPES.includes(r.type));
    }

    // newest first, which is what both queues want and what the audit log page expects
    requests.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.status(200).json(requests);
});

app.post('/requests', (req, res) => {
    const { type, requestedBy, groupId, payload } = req.body;
    const requester = normaliseEmail(requestedBy);

        if (!type || !requester) {
            return res.status(400).json({ error: 'Request type and requester are required' });
    }

    const users = readData(usersPath);
    const requesterUser = users.find(u => u.email === requester);
        if (!requesterUser) {
            return res.status(404).json({ error: 'User not found' });
    }
        // the spec says the super admin only actions requests and can never raise one, which
        // is also what stops them approving their own
        if (requesterUser.role === 'super') {
            return res.status(403).json({ error: 'The super admin cannot raise requests, only action them' });
    }

    const groups = readGroups();
    const requests = readData(requestsPath);
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
                if (groups.find(g => g.name.toLowerCase() === name.toLowerCase())) {
                    return res.status(409).json({ error: 'A group with that name already exists' });
            }
                // names are unique, so two people can't have the same name pending either
                if (requests.find(r => r.status === 'pending' && r.type === 'group-create'
                    && String(r.payload.name).toLowerCase() === name.toLowerCase())) {
                    return res.status(409).json({ error: 'A group with that name has already been requested' });
            }
            summary = `Create group "${name}"`;
            break;
        }

        case 'group-delete': {
            const group = groups.find(g => g.id === groupId);
                if (!group) {
                    return res.status(404).json({ error: 'Group not found' });
            }
                if (!group.adminEmails.includes(requester)) {
                    return res.status(403).json({ error: 'Only an admin of this group can request its deletion' });
            }
                if (requests.find(r => r.status === 'pending' && r.type === 'group-delete' && r.groupId === groupId)) {
                    return res.status(409).json({ error: 'A deletion request for this group is already pending' });
            }
            summary = `Delete group "${group.name}"`;
            break;
        }

        case 'channel-create': {
            const group = groups.find(g => g.id === groupId);
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
            const channels = readData(channelsPath);
                if (channels.find(c => c.groupId === groupId && c.name.toLowerCase() === roomName.toLowerCase())) {
                    return res.status(409).json({ error: 'That group already has a channel with this name' });
            }
                if (requests.find(r => r.status === 'pending' && r.type === 'channel-create' && r.groupId === groupId
                    && String(r.payload.name).toLowerCase() === roomName.toLowerCase())) {
                    return res.status(409).json({ error: 'That room has already been proposed' });
            }
            summary = `Create room "${roomName}" in "${group.name}"`;
            break;
        }

        case 'user-ban': {
            const target = normaliseEmail(details.email);
            const group = groups.find(g => g.id === groupId);
                if (!group) {
                    return res.status(404).json({ error: 'Group not found' });
            }
                // "admins cannot ban directly without a prior report" — the report is this
                // request, and only a group admin can raise it
                if (!group.adminEmails.includes(requester)) {
                    return res.status(403).json({ error: 'Only a group admin can report a user for a system wide ban' });
            }
            const targetUser = users.find(u => u.email === target);
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
                const stillAdminSomewhere = groups.find(g => g.adminEmails.includes(target) && g.adminEmails.length === 1);
                if (stillAdminSomewhere) {
                    return res.status(409).json({ error: `${target} is the only admin of "${stillAdminSomewhere.name}". Assign a replacement admin there first.` });
            }
                if (requests.find(r => r.status === 'pending' && r.type === 'user-ban' && r.payload.email === target)) {
                    return res.status(409).json({ error: 'A ban request for that user is already pending' });
            }
            summary = `Permanently ban ${target}`;
            break;
        }

        default:
            return res.status(400).json({ error: 'Unknown request type' });
    }

    const newRequest = {
        id: makeId('r'),
        type,
        status: 'pending',      // pending -> approved or rejected. the spec says there's no cancelling, so there's no route that sets it back
        summary,                // written once here so every queue can render a row without re-deriving the wording
        requestedBy: requester,
        groupId: groupId ?? '',
        payload: details,
        createdAt: new Date().toISOString(),
        resolvedAt: '',
        resolvedBy: '',
        reason: '',             // only filled in on a rejection, which the spec requires a reason for
    };

    requests.push(newRequest);
    writeData(requestsPath, requests);
    logAudit('Request Raised', requester, summary);
    res.status(201).json(newRequest);
});

app.post('/requests/:id/approve', (req, res) => {
    const actor = normaliseEmail(req.body.actorEmail);

    const requests = readData(requestsPath);
    const request = requests.find(r => r.id === req.params.id);
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

    const users = readData(usersPath);
    const actorUser = users.find(u => u.email === actor);
        if (!actorUser) {
            return res.status(404).json({ error: 'User not found' });
    }

    const groups = readGroups();

    // who is allowed to action this depends on the type: the super admin for the three system
    // level ones, an admin of the group in question for a room proposal
        if (SUPER_TYPES.includes(request.type)) {
            if (actorUser.role !== 'super') {
                return res.status(403).json({ error: 'Only the super admin can action this request' });
        }
    } else {
            const group = groups.find(g => g.id === request.groupId);
            if (!group || !group.adminEmails.includes(actor)) {
                return res.status(403).json({ error: 'Only an admin of this group can action this request' });
        }
    }

    // carrying out the request is the whole point of approving it, so each type does its work here
    switch (request.type) {
        case 'group-create': {
            const created = createGroupRecord(groups, request.payload, request.requestedBy);
            writeData(groupsPath, groups);
            logAudit('Group Created', actor, `Approved "${created.name}", ${request.requestedBy} is its first admin`);
            break;
        }

        case 'group-delete': {
            const group = groups.find(g => g.id === request.groupId);
                if (!group) {
                    return res.status(404).json({ error: 'Group not found' });
            }
            writeData(groupsPath, groups.filter(g => g.id !== group.id));
            writeData(channelsPath, readData(channelsPath).filter(c => c.groupId !== group.id));
            logAudit('Group Deleted', actor, `Approved deletion of "${group.name}" and its rooms`);
            break;
        }

        case 'channel-create': {
            const channels = readData(channelsPath);
            const roomName = String(request.payload.name).trim();
                // re-checked at approval time, not just when the request was raised — an admin
                // could have created a room with the same name while this sat in the queue
                if (channels.find(c => c.groupId === request.groupId && c.name.toLowerCase() === roomName.toLowerCase())) {
                    return res.status(409).json({ error: 'That group already has a channel with this name' });
            }
            channels.push({ id: makeId('c'), groupId: request.groupId, name: roomName });
            writeData(channelsPath, channels);
            logAudit('Room Created', actor, `Approved room "${roomName}" proposed by ${request.requestedBy}`);
            break;
        }

        case 'user-ban': {
            const target = normaliseEmail(request.payload.email);
                // re-checked here too: someone could have been left as a group's only admin
                // since the report was raised, and the spec says a replacement comes first
                const onlyAdminOf = groups.find(g => g.adminEmails.includes(target) && g.adminEmails.length === 1);
                if (onlyAdminOf) {
                    return res.status(409).json({ error: `${target} is the only admin of "${onlyAdminOf.name}". A replacement admin must be assigned before the ban.` });
            }

            // a system wide ban is permanent, so it happens in three parts: the account is
            // deleted, they're pulled out of every group, and the email goes on the banned
            // list so /register can never hand it out again
            writeData(usersPath, users.filter(u => u.email !== target));

            groups.forEach(g => {
                g.memberEmails = g.memberEmails.filter(m => m !== target);
                g.adminEmails = g.adminEmails.filter(a => a !== target);
            });
            writeData(groupsPath, groups);

            const banned = readData(bannedPath);
            banned.push({
                email: target,
                reason: request.payload.reason ?? '',
                reportedBy: request.requestedBy,
                bannedAt: new Date().toISOString(),
                bannedBy: actor,
            });
            writeData(bannedPath, banned);
            logAudit('User Banned', actor, `Permanently banned ${target} — ${request.payload.reason ?? 'no reason given'}`);
            break;
        }
    }

    request.status = 'approved';
    request.resolvedAt = new Date().toISOString();
    request.resolvedBy = actor;
    writeData(requestsPath, requests);
    res.status(200).json(request);
});

app.post('/requests/:id/reject', (req, res) => {
    const actor = normaliseEmail(req.body.actorEmail);
    const reason = String(req.body.reason ?? '').trim();

        // the spec is explicit that a rejected request must include a reason, so this is a
        // 400 rather than something the client is trusted to enforce
        if (!reason) {
            return res.status(400).json({ error: 'A reason is required when rejecting a request' });
    }

    const requests = readData(requestsPath);
    const request = requests.find(r => r.id === req.params.id);
        if (!request) {
            return res.status(404).json({ error: 'Request not found' });
    }
        if (request.status !== 'pending') {
            return res.status(409).json({ error: 'That request has already been actioned' });
    }
        if (request.requestedBy === actor) {
            return res.status(403).json({ error: 'You cannot action your own request' });
    }

    const actorUser = readData(usersPath).find(u => u.email === actor);
        if (!actorUser) {
            return res.status(404).json({ error: 'User not found' });
    }

    // the same authority check as approve — rejecting is just as much an admin action
        if (SUPER_TYPES.includes(request.type)) {
            if (actorUser.role !== 'super') {
                return res.status(403).json({ error: 'Only the super admin can action this request' });
        }
    } else {
            const group = readGroups().find(g => g.id === request.groupId);
            if (!group || !group.adminEmails.includes(actor)) {
                return res.status(403).json({ error: 'Only an admin of this group can action this request' });
        }
    }

    request.status = 'rejected';
    request.reason = reason;        // the user sees this on their profile page under past rejected requests
    request.resolvedAt = new Date().toISOString();
    request.resolvedBy = actor;
    writeData(requestsPath, requests);
    logAudit('Request Rejected', actor, `${request.summary} — rejected: ${reason}`);
    res.status(200).json(request);
});


//bans and audit routes

app.get('/bans', (req, res) => {        // every permanently banned account, the super admin sees these system wide
    res.status(200).json(readData(bannedPath));
});

// the spec asks for an audit log page that's filterable by type and in date order, so the
// filtering and the sorting both happen here rather than in the component
app.get('/audit', (req, res) => {
    const { type } = req.query;
    let entries = readData(auditPath);

        if (type) {
            entries = entries.filter(e => e.type === type);
    }

    entries.sort((a, b) => b.at.localeCompare(a.at));   // newest first
    res.status(200).json(entries);
});

// the distinct types actually present in the log, so the filter dropdown lists real values
// instead of a hardcoded list that drifts out of date
app.get('/audit/types', (req, res) => {
    const types = [...new Set(readData(auditPath).map(e => e.type))].sort();
    res.status(200).json(types);
});


const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
