// the socket.io layer: joining, presence, join/leave notices, text and image messages, history.
// real socket.io-client connections, so two clients behave like two browser tabs.

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const { io: connect } = require('socket.io-client');
const { startServer, reset, uploadImage } = require('./helpers');

let ctx;
let ids;
let open = [];      // every client a test opened, disconnected in afterEach

before(async () => {
    ctx = await startServer('fabulari_test_sockets');
});
after(() => ctx.stop());
beforeEach(async () => {
    ids = await reset(ctx.db);
});
afterEach(() => {
    open.forEach(socket => socket.disconnect());
    open = [];
});

// a connected client. forceNew stops two clients sharing one connection
async function client() {
    const socket = connect(ctx.base, { forceNew: true, transports: ['websocket'] });
    open.push(socket);
    await new Promise((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
    });
    return socket;
}

// emit and wait for the ack
function emit(socket, event, payload) {
    return new Promise(resolve => socket.emit(event, payload, resolve));
}

// the next `event` on this socket, with a timeout so a missing event fails instead of hanging
function next(socket, event, ms = 2000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no "${event}" within ${ms}ms`)), ms);
        socket.once(event, data => {
            clearTimeout(timer);
            resolve(data);
        });
    });
}

// the first `event` whose payload passes the check. presence is sent on every join and leave,
// so the next one isn't always the one the test wants
function waitFor(socket, event, check, ms = 2000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.off(event, handler);
            reject(new Error(`no matching "${event}" within ${ms}ms`));
        }, ms);
        function handler(data) {
            if (check(data)) {
                clearTimeout(timer);
                socket.off(event, handler);
                resolve(data);
            }
        }
        socket.on(event, handler);
    });
}

// passes only if `event` does NOT arrive in time
function nothing(socket, event, ms = 300) {
    return new Promise((resolve, reject) => {
        const handler = data => reject(new Error(`unexpected "${event}": ${JSON.stringify(data)}`));
        socket.once(event, handler);
        setTimeout(() => {
            socket.off(event, handler);
            resolve();
        }, ms);
    });
}

async function joined(email) {
    const socket = await client();
    const ack = await emit(socket, 'joinRoom', { channelId: ids.channelId, email });
    assert.equal(ack.error, undefined, ack.error);
    return { socket, ack };
}


describe('joinRoom', () => {
    it('lets a member in and acks with the history and who is present', async () => {
        const { ack } = await joined('bob@test.com');
        assert.deepEqual(ack.history, []);
        assert.deepEqual(ack.present, ['bob@test.com']);
    });

    it('refuses someone who isn\'t in the group', async () => {
        const socket = await client();
        const ack = await emit(socket, 'joinRoom', { channelId: ids.channelId, email: 'carol@test.com' });
        assert.equal(ack.error, 'You are not a member of this group');
    });

    it('refuses a malformed or unknown room', async () => {
        const socket = await client();
        assert.equal((await emit(socket, 'joinRoom', { channelId: 'nope', email: 'bob@test.com' })).error, 'Bad room or user');
        assert.equal((await emit(socket, 'joinRoom', { channelId: String(new ObjectId()), email: 'bob@test.com' })).error, 'Room not found');
    });

    it('tells the people already there, but not the joiner, that someone arrived', async () => {
        const alice = await joined('alice@test.com');
        const bob = await client();

        const notice = next(alice.socket, 'userJoined');
        const presence = waitFor(alice.socket, 'presence', list => list.includes('bob@test.com'));
        const bobHearsHimself = nothing(bob, 'userJoined');     // socket.to() excludes the sender
        await emit(bob, 'joinRoom', { channelId: ids.channelId, email: 'bob@test.com' });

        assert.deepEqual(await notice, { email: 'bob@test.com' });
        assert.deepEqual((await presence).sort(), ['alice@test.com', 'bob@test.com']);
        await bobHearsHimself;
    });

    it('replays the most recent history oldest first', async () => {
        const channelId = new ObjectId(ids.channelId);
        await ctx.db.collection('messages').insertMany([
            { channelId, sender: 'alice@test.com', body: 'second', imageUrl: '', at: '2026-09-02T00:00:00.000Z' },
            { channelId, sender: 'bob@test.com', body: 'first', imageUrl: '', at: '2026-09-01T00:00:00.000Z' },
        ]);
        const { ack } = await joined('bob@test.com');
        assert.deepEqual(ack.history.map(m => m.body), ['first', 'second']);
    });
});


describe('sendMessage', () => {
    it('refuses to send before joining a room', async () => {
        const socket = await client();
        assert.equal((await emit(socket, 'sendMessage', { body: 'hi' })).error, 'Join a room first');
    });

    it('refuses an empty message', async () => {
        const { socket } = await joined('bob@test.com');
        assert.equal((await emit(socket, 'sendMessage', { body: '   ' })).error, 'Message cannot be empty');
    });

    it('broadcasts to everyone in the room, the sender included, and stores it', async () => {
        const alice = await joined('alice@test.com');
        const bob = await joined('bob@test.com');

        const toAlice = next(alice.socket, 'newMessage');
        const toBob = next(bob.socket, 'newMessage');       // io.to() includes the sender
        assert.deepEqual(await emit(bob.socket, 'sendMessage', { body: 'hello' }), { ok: true });

        assert.equal((await toAlice).body, 'hello');
        assert.equal((await toBob).body, 'hello');
        assert.equal(await ctx.db.collection('messages').countDocuments({ body: 'hello' }), 1);
    });

    it('takes the sender from the join, so a client can\'t post as someone else', async () => {
        const { socket } = await joined('bob@test.com');
        const received = next(socket, 'newMessage');
        await emit(socket, 'sendMessage', { body: 'it was alice', email: 'alice@test.com', sender: 'alice@test.com' });
        assert.equal((await received).sender, 'bob@test.com');
    });

    it('refuses a sender who was removed from the group after joining', async () => {
        const { socket } = await joined('bob@test.com');
        await ctx.db.collection('groups').updateOne(
            { _id: new ObjectId(ids.groupId) }, { $pull: { memberEmails: 'bob@test.com' } });
        const ack = await emit(socket, 'sendMessage', { body: 'still here?' });
        assert.equal(ack.error, 'You are no longer a member of this group');
        assert.equal(await ctx.db.collection('messages').countDocuments({ body: 'still here?' }), 0);
    });

    it('sends an image that was uploaded through POST /uploads', async () => {
        const upload = await uploadImage(ctx.base, { email: 'bob@test.com', channelId: ids.channelId });
        ctx.uploaded.push(upload.body.imageUrl);

        const { socket } = await joined('bob@test.com');
        const received = next(socket, 'newMessage');
        assert.deepEqual(await emit(socket, 'sendMessage', { body: '', imageUrl: upload.body.imageUrl }), { ok: true });
        assert.equal((await received).imageUrl, upload.body.imageUrl);
    });

    it('refuses an image url the server never handed out', async () => {
        const { socket } = await joined('bob@test.com');
        const outside = await emit(socket, 'sendMessage', { imageUrl: 'https://evil.example/track.png' });
        const madeUp = await emit(socket, 'sendMessage', { imageUrl: '/uploads/00000000-0000-0000-0000-000000000000.png' });
        assert.match(outside.error, /could not be found/);
        assert.match(madeUp.error, /could not be found/);
        assert.equal(await ctx.db.collection('messages').countDocuments(), 0);
    });
});


describe('leaveRoom and disconnect', () => {
    it('leaving tells the others and updates the presence list', async () => {
        const alice = await joined('alice@test.com');
        // wait for bob's arrival first, or alice's own ['alice'] list could be mistaken for the leave
        const bobArrived = waitFor(alice.socket, 'presence', list => list.includes('bob@test.com'));
        const bob = await joined('bob@test.com');
        await bobArrived;

        const notice = next(alice.socket, 'userLeft');
        const presence = waitFor(alice.socket, 'presence', list => !list.includes('bob@test.com'));
        bob.socket.emit('leaveRoom');

        assert.deepEqual(await notice, { email: 'bob@test.com' });
        assert.deepEqual(await presence, ['alice@test.com']);
    });

    it('closing the connection counts as leaving', async () => {
        const alice = await joined('alice@test.com');
        const bob = await joined('bob@test.com');

        const notice = next(alice.socket, 'userLeft');
        bob.socket.disconnect();
        assert.deepEqual(await notice, { email: 'bob@test.com' });
    });

    it('someone joining afterwards doesn\'t see a ghost of who left', async () => {
        const bob = await joined('bob@test.com');
        bob.socket.emit('leaveRoom');
        await new Promise(resolve => setTimeout(resolve, 100));     // leaveRoom has no ack
        const { ack } = await joined('alice@test.com');
        assert.deepEqual(ack.present, ['alice@test.com']);
    });
});
