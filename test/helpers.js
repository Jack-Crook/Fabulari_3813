// shared setup for the server tests: a real server on a spare port against its own test
// database, reset to the same state before each test. nothing is mocked.

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');

const PASSWORD = 'password1';     // every fixture account's password

// hashed once, at cost 4 (bcrypt's minimum) for speed. compare() reads the cost from the hash,
// so login treats it the same as a cost 10 hash.
const HASH = bcrypt.hashSync(PASSWORD, 4);

async function startServer(dbName) {
    // reset() wipes the database, so only run against one named as a test database
    if (!/test/.test(dbName)) {
        throw new Error(`Refusing to run tests against "${dbName}", the name must contain "test"`);
    }
    // server.js reads DB_NAME when first required, so set it before
    process.env.DB_NAME = dbName;
    const { server, io, start, UPLOAD_DIR } = require('../server');

    const client = await start(0);      // 0 = any free port, doesn't clash with a dev server on 3000
    const db = client.db(dbName);
    const base = `http://localhost:${server.address().port}`;

    // test uploads land in the real uploads/ folder, so they're tracked and removed at the end
    const uploaded = [];

    async function stop() {
        await Promise.all(uploaded.map(url =>
            fs.promises.rm(path.join(UPLOAD_DIR, path.basename(url)), { force: true })));
        await db.dropDatabase();
        server.closeAllConnections();   // fetch keeps connections alive, which would stop close() finishing
        await new Promise(resolve => io.close(resolve));   // closes socket.io and its http server
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

    // ids as strings, the way a client sends them
    return { groupId: String(groupId), channelId: String(channelId) };
}

// fetch that returns status and parsed body together
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
            json = text;        // GET / answers with plain text
        }
        return { status: res.status, body: json, headers: res.headers };
    };
}

// a real 1x1 png
const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64');

// multipart upload, the same as ChatService's FormData
async function uploadImage(base, { email, channelId, bytes = PNG, type = 'image/png', name = 'pic.png' }) {
    const form = new FormData();
    form.append('email', email);
    form.append('channelId', channelId);
    form.append('image', new Blob([bytes], { type }), name);
    const res = await fetch(`${base}/uploads`, { method: 'POST', body: form });
    return { status: res.status, body: await res.json() };
}

// profile picture upload, the same as Auth.uploadAvatar: actorEmail first, then the file
async function uploadAvatar(base, { email, actorEmail = email, bytes = PNG, type = 'image/png', name = 'me.png' }) {
    const form = new FormData();
    form.append('actorEmail', actorEmail);
    form.append('image', new Blob([bytes], { type }), name);
    const res = await fetch(`${base}/users/${encodeURIComponent(email)}/avatar`, { method: 'POST', body: form });
    return { status: res.status, body: await res.json() };
}

module.exports = { PASSWORD, startServer, reset, api, uploadImage, uploadAvatar, PNG };
