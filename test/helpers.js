// shared setup for the server tests. each test file calls startServer() with its own database
// name, gets back a real running server on a spare port, and calls reset() before each test so
// every test starts from the same known state.
//
// these are integration tests rather than unit tests: requests go over real http to the real
// express app, which talks to a real mongo. nothing is mocked, so a passing test means the
// route actually works end to end, not just that its logic works in isolation.

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');

const PASSWORD = 'password1';     // every fixture account's password

// hashed once when the file loads rather than once per test. cost 4 is bcrypt's minimum, which
// keeps the fixtures fast. that's fine because compare() reads the cost out of the hash itself,
// so login checks these exactly the same way it checks a real cost 10 hash.
const HASH = bcrypt.hashSync(PASSWORD, 4);

async function startServer(dbName) {
    // reset() deletes every document in the database it's pointed at. a seed run once wiped
    // real data it wasn't meant to touch, so this refuses to go anywhere near a database whose
    // name doesn't say it's for testing.
    if (!/test/.test(dbName)) {
        throw new Error(`Refusing to run tests against "${dbName}", the name must contain "test"`);
    }
    // server.js reads DB_NAME once, when it's first required, so this has to be set before that
    process.env.DB_NAME = dbName;
    const { server, io, start, UPLOAD_DIR } = require('../server');

    const client = await start(0);      // 0 = any free port, so a running dev server on 3000 doesn't matter
    const db = client.db(dbName);
    const base = `http://localhost:${server.address().port}`;

    // uploads made during the tests go into the real uploads/ folder, so they're tracked here
    // and removed at the end rather than left behind
    const uploaded = [];

    async function stop() {
        await Promise.all(uploaded.map(url =>
            fs.promises.rm(path.join(UPLOAD_DIR, path.basename(url)), { force: true })));
        await db.dropDatabase();
        server.closeAllConnections();   // fetch keeps connections open for reuse, which would stop close() finishing
        await new Promise(resolve => io.close(resolve));   // closes socket.io and the http server under it
        await client.close();
    }

    return { base, db, stop, uploaded, UPLOAD_DIR };
}

// the same small world before every test:
//   super@test.com  the super admin
//   alice@test.com  only admin of Book Club
//   bob@test.com    a member of Book Club
//   carol@test.com  in no group, and no date of birth stored
//   kid@test.com    ten years old, in no group
// Book Club has one room, General.
async function reset(db) {
    const names = ['users', 'groups', 'channels', 'requests', 'audit', 'banned', 'messages'];
    await Promise.all(names.map(name => db.collection(name).deleteMany({})));

    const tenYearsAgo = new Date();
    tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);

    const user = (email, role, dob) => ({
        email, password: HASH, role, username: email.split('@')[0], dob, bio: '',
        createdAt: new Date().toISOString(),
    });
    await db.collection('users').insertMany([
        user('super@test.com', 'super', '1980-01-01'),
        user('alice@test.com', 'user', '1995-05-05'),
        user('bob@test.com', 'user', '2000-01-01'),
        user('carol@test.com', 'user', ''),
        user('kid@test.com', 'user', tenYearsAgo.toISOString().slice(0, 10)),
    ]);

    const { insertedId: groupId } = await db.collection('groups').insertOne({
        name: 'Book Club', description: 'books', ageLimit: 0, theme: '#5FA8D3',
        adminEmails: ['alice@test.com'],
        memberEmails: ['alice@test.com', 'bob@test.com'],
        bannedEmails: [],
    });
    const { insertedId: channelId } = await db.collection('channels').insertOne({ groupId, name: 'General' });

    // ids go back as strings, the same form a client sends them in
    return { groupId: String(groupId), channelId: String(channelId) };
}

// fetch plus the parsed json body, so each test reads as one line: status and body together
function api(base) {
    return async (method, url, body) => {
        const res = await fetch(base + url, {
            method,
            headers: body ? { 'Content-Type': 'application/json' } : {},
            body: body ? JSON.stringify(body) : undefined,
        });
        const text = await res.text();
        let json;
        try {
            json = JSON.parse(text);
        } catch {
            json = text;        // GET / answers with plain text, not json
        }
        return { status: res.status, body: json, headers: res.headers };
    };
}

// a real 1x1 png, so multer and the type check see an actual image rather than a label on nothing
const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64');

// multipart upload the same way the browser's FormData does it in ChatService
async function uploadImage(base, { email, channelId, bytes = PNG, type = 'image/png', name = 'pic.png' }) {
    const form = new FormData();
    form.append('email', email);
    form.append('channelId', channelId);
    form.append('image', new Blob([bytes], { type }), name);
    const res = await fetch(`${base}/uploads`, { method: 'POST', body: form });
    return { status: res.status, body: await res.json() };
}

// a profile picture upload, the same shape as Auth.uploadAvatar: actorEmail first, then the file
async function uploadAvatar(base, { email, actorEmail = email, bytes = PNG, type = 'image/png', name = 'me.png' }) {
    const form = new FormData();
    form.append('actorEmail', actorEmail);
    form.append('image', new Blob([bytes], { type }), name);
    const res = await fetch(`${base}/users/${encodeURIComponent(email)}/avatar`, { method: 'POST', body: form });
    return { status: res.status, body: await res.json() };
}

module.exports = { PASSWORD, startServer, reset, api, uploadImage, uploadAvatar, PNG };
