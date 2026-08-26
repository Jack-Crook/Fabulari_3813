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

// ids only have to be unique inside this prototype, and a timestamp is enough for that.
// phase 2 drops this because mongo generates _id itself.
function makeId(prefix) {
  return prefix + Date.now();
}

// the spec says email is the unique identifier for a user, so it gets trimmed and lowercased everywhere.
// without this Test@Test.com and test@test.com would be stored as two different people.
function normaliseEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}


//register route
app.post('/register', (req, res) => {       // handles new user signups
  const { email, password } = req.body;     // pull fields out of the request body

    if (!email || !password) {    // reject the request early if either field is missing/empty
    return res.status(400).json({ error: 'Email and password are required' });      // 400 = Bad Request, it tells the client (Angular) it sent invalid input,
  }

  const cleanEmail = normaliseEmail(email);       // compare and store the same tidied up version every time

  const users = readData(usersPath);// read the users.json file and parse it into a real JS array so it can be searched and pushed onto below

  const existingUser = users.find(user => user.email === cleanEmail);        // check if email is already registered
    if (existingUser) {
        return res.status(409).json({error: 'Email is already registered'});        //
    }
    users.push({ email: cleanEmail, password, role: 'user' });   // everyone self registers as a normal user, the one super admin is set in users.json by hand
    writeData(usersPath, users);
    res.status(201).json({ message: 'User registered successfully' });
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
    res.status(200).json({ message: 'Login successful', email: user.email, role: user.role });  // role goes back too so Angular knows which dashboard to show
});


//groups routes

app.get('/groups', (req, res) => {      // send back every group, the dashboard uses this for both My Groups and Discover
    res.status(200).json(readData(groupsPath));
});

app.post('/groups', (req, res) => {     // creates a group
    const { name, description, ageLimit, theme, creatorEmail } = req.body;

        if (!name || !creatorEmail) {       // a group with no name, or with nobody to admin it, isn't valid
            return res.status(400).json({ error: 'Group name and creator email are required' });
    }

    const groups = readData(groupsPath);

    const existingGroup = groups.find(g => g.name.toLowerCase() === name.trim().toLowerCase());  // stop two groups ending up with the same name
        if (existingGroup) {
            return res.status(409).json({ error: 'A group with that name already exists' });
    }

    const creator = normaliseEmail(creatorEmail);

    const users = readData(usersPath);
    const creatorUser = users.find(u => u.email === creator);
    if (creatorUser?.role === 'super') {
        return res.status(409).json({ error: 'The super admin cannot create or admin a group' });
    }

    const newGroup = {
        id: makeId('g'),
        name: name.trim(),
        description: description ?? '',
        ageLimit: ageLimit ?? 0,        // 0 means no age limit. the spec puts the limit on the group, and it covers every channel inside it
        theme: theme ?? '#5FA8D3',      // the group's colour, which carries through to its chat rooms
        adminEmails: [creator],         // the spec says a group must always have at least one admin, so whoever asked for it becomes the first one
        memberEmails: [creator],        // that admin is a member of the group as well
    };

    groups.push(newGroup);
    writeData(groupsPath, groups);
    res.status(201).json(newGroup);
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

    const groups = readData(groupsPath);
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

    
    group.memberEmails.push(email);     // group is a reference into the groups array, so pushing here changes the array that gets written below
    writeData(groupsPath, groups);
    res.status(200).json(group);
});

app.delete('/groups/:id/members/:email', (req, res) => {    // removes a user from a group, this is the group level ban/leave, not a system wide delete
    const email = normaliseEmail(req.params.email);

    const groups = readData(groupsPath);
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

    const groups = readData(groupsPath);
        if (!groups.find(g => g.id === groupId)) {      // a channel can't exist on its own, it has to belong to a real group
            return res.status(404).json({ error: 'Group not found' });
    }

    const channels = readData(channelsPath);

    const existingChannel = channels.find(c => c.groupId === groupId && c.name.toLowerCase() === name.trim().toLowerCase());
        if (existingChannel) {      // two channels can share a name across different groups, just not inside the same one
            return res.status(409).json({ error: 'That group already has a channel with this name' });
    }

    const newChannel = { id: makeId('c'), groupId, name: name.trim() };
    channels.push(newChannel);
    writeData(channelsPath, channels);
    res.status(201).json(newChannel);
});

app.delete('/channels/:id', (req, res) => {     // group admins can delete a room they made, so this removes one by id
    const channels = readData(channelsPath);
    const remaining = channels.filter(c => c.id !== req.params.id);

        if (remaining.length === channels.length) {     // nothing was filtered out, so that id never existed
            return res.status(404).json({ error: 'Channel not found' });
    }

    writeData(channelsPath, remaining);
    res.status(200).json({ message: 'Channel deleted' });
});


const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
