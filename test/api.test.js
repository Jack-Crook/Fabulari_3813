// every REST route, success path and rules. `npm test` from the repo root, needs mongod.

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { ObjectId } = require('mongodb');
const { PASSWORD, startServer, reset, api, uploadImage, uploadAvatar } = require('./helpers');

let ctx;        // { base, db, stop, uploaded, UPLOAD_DIR }
let call;       // call(method, url, body) -> { status, body }
let ids;        // { groupId, channelId } of the fixture Book Club and its General room

before(async () => {
    ctx = await startServer('fabulari_test_api');
    call = api(ctx.base);
});
after(() => ctx.stop());
beforeEach(async () => {
    ids = await reset(ctx.db);
});

const missingId = String(new ObjectId());       // a well formed id that matches nothing

// raise a request as `by` and return its id, for the approve and reject tests
async function raise(by, type, extra = {}) {
    const res = await call('POST', '/requests', { type, requestedBy: by, ...extra });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body._id;
}

// inserts a group directly, since there's no route that creates one without a request
async function addGroup(name, adminEmail) {
    await ctx.db.collection('groups').insertOne({
        name, description: '', ageLimit: 0, theme: '#5FA8D3',
        adminEmails: [adminEmail], memberEmails: [adminEmail], bannedEmails: [],
    });
}


describe('GET /', () => {
    it('answers so you can tell the server is up', async () => {
        const res = await call('GET', '/');
        assert.equal(res.status, 200);
        assert.equal(res.body, 'Fabulari API running');
    });
});


describe('request bodies', () => {
    it('answers 400 for a body that isn\'t valid JSON, not a 500', async () => {
        const res = await fetch(ctx.base + '/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops',
        });
        assert.equal(res.status, 400);
        assert.equal((await res.json()).error, 'The request body is not valid JSON');
    });
});


describe('POST /register', () => {
    it('makes the first account on an empty system the super admin, and everyone after a user', async () => {
        await ctx.db.collection('users').deleteMany({});
        const first = await call('POST', '/register', { email: 'first@test.com', password: 'secret1' });
        const second = await call('POST', '/register', { email: 'second@test.com', password: 'secret1' });
        assert.equal(first.status, 201);
        assert.equal(first.body.role, 'super');
        assert.equal(second.status, 201);
        assert.equal(second.body.role, 'user');
    });

    it('stores a bcrypt hash, never the typed password', async () => {
        await call('POST', '/register', { email: 'new@test.com', password: 'secret1' });
        const stored = await ctx.db.collection('users').findOne({ email: 'new@test.com' });
        assert.notEqual(stored.password, 'secret1');
        assert.match(stored.password, /^\$2[aby]\$10\$/);    // bcrypt format, cost 10
    });

    it('normalises the email, so a different case is still a duplicate', async () => {
        const res = await call('POST', '/register', { email: '  BOB@Test.com ', password: 'secret1' });
        assert.equal(res.status, 409);
    });

    it('rejects missing fields, a malformed email and a short password with 400', async () => {
        assert.equal((await call('POST', '/register', { email: 'x@test.com' })).status, 400);
        assert.equal((await call('POST', '/register', { email: 'not-an-email', password: 'secret1' })).status, 400);
        assert.equal((await call('POST', '/register', { email: 'x@test.com', password: '123' })).status, 400);
    });

    it('refuses a permanently banned email with 403', async () => {
        await ctx.db.collection('banned').insertOne({ email: 'gone@test.com' });
        const res = await call('POST', '/register', { email: 'gone@test.com', password: 'secret1' });
        assert.equal(res.status, 403);
    });

    it('refuses a date of birth in the future, and a display name over 50 characters, with 400', async () => {
        assert.equal((await call('POST', '/register', { email: 'x@test.com', password: 'secret1', dob: '2999-01-01' })).status, 400);
        assert.equal((await call('POST', '/register', { email: 'x@test.com', password: 'secret1', username: 'n'.repeat(51) })).status, 400);
    });

    it('makes one account and a 409 when the same email registers twice at once', async () => {
        const both = await Promise.all([1, 2].map(() =>
            call('POST', '/register', { email: 'twice@test.com', password: 'secret1' })));
        assert.deepEqual(both.map(r => r.status).sort(), [201, 409]);
        assert.equal(await ctx.db.collection('users').countDocuments({ email: 'twice@test.com' }), 1);
    });
});


describe('POST /login', () => {
    it('logs in with the right password and never sends the password back', async () => {
        const res = await call('POST', '/login', { email: 'alice@test.com', password: PASSWORD });
        assert.equal(res.status, 200);
        assert.equal(res.body.email, 'alice@test.com');
        assert.equal(res.body.role, 'user');
        assert.equal(res.body.password, undefined);
    });

    it('gives the same 401 for a wrong password and an unknown email', async () => {
        const wrong = await call('POST', '/login', { email: 'alice@test.com', password: 'nope123' });
        const unknown = await call('POST', '/login', { email: 'nobody@test.com', password: PASSWORD });
        assert.equal(wrong.status, 401);
        assert.equal(unknown.status, 401);
        assert.deepEqual(wrong.body, unknown.body);     // identical, so it doesn't reveal which accounts exist
    });

    it('rejects a missing field with 400', async () => {
        assert.equal((await call('POST', '/login', { email: 'alice@test.com' })).status, 400);
    });
});


describe('GET /users', () => {
    it('lists every account with the passwords stripped', async () => {
        const res = await call('GET', '/users');
        assert.equal(res.status, 200);
        assert.equal(res.body.length, 5);
        assert.ok(res.body.every(u => u.password === undefined));
    });
});


describe('GET /users/:email', () => {
    it('returns one account, or 404', async () => {
        const found = await call('GET', '/users/bob@test.com');
        assert.equal(found.status, 200);
        assert.equal(found.body.username, 'bob');
        assert.equal(found.body.password, undefined);
        assert.equal((await call('GET', '/users/nobody@test.com')).status, 404);
    });
});


describe('PUT /users/:email', () => {
    it('lets a user edit their own profile but not their role', async () => {
        const res = await call('PUT', '/users/bob@test.com', {
            actorEmail: 'bob@test.com', username: 'Robert', bio: 'hi', role: 'super',
        });
        assert.equal(res.status, 200);
        assert.equal(res.body.username, 'Robert');
        assert.equal(res.body.bio, 'hi');
        assert.equal(res.body.role, 'user');
    });

    it('hashes a changed password, and the new one logs in', async () => {
        await call('PUT', '/users/bob@test.com', { actorEmail: 'bob@test.com', password: 'brandnew1' });
        const stored = await ctx.db.collection('users').findOne({ email: 'bob@test.com' });
        assert.notEqual(stored.password, 'brandnew1');
        assert.equal((await call('POST', '/login', { email: 'bob@test.com', password: 'brandnew1' })).status, 200);
        assert.equal((await call('POST', '/login', { email: 'bob@test.com', password: PASSWORD })).status, 401);
    });

    it('refuses to edit someone else\'s profile with 403', async () => {
        const res = await call('PUT', '/users/bob@test.com', { actorEmail: 'alice@test.com', username: 'x' });
        assert.equal(res.status, 403);
    });

    it('rejects an invalid or future date of birth, an empty username and a long bio with 400', async () => {
        assert.equal((await call('PUT', '/users/bob@test.com', { actorEmail: 'bob@test.com', dob: 'yesterday' })).status, 400);
        assert.equal((await call('PUT', '/users/bob@test.com', { actorEmail: 'bob@test.com', dob: '2999-01-01' })).status, 400);
        assert.equal((await call('PUT', '/users/bob@test.com', { actorEmail: 'bob@test.com', username: '  ' })).status, 400);
        assert.equal((await call('PUT', '/users/bob@test.com', { actorEmail: 'bob@test.com', bio: 'b'.repeat(501) })).status, 400);
    });

    it('saves and logs nothing when nothing was sent', async () => {
        const res = await call('PUT', '/users/bob@test.com', { actorEmail: 'bob@test.com' });
        assert.equal(res.status, 200);
        assert.equal(await ctx.db.collection('audit').countDocuments(), 0);
    });

    it('answers 404 for an account that doesn\'t exist', async () => {
        const res = await call('PUT', '/users/nobody@test.com', { actorEmail: 'nobody@test.com', bio: 'x' });
        assert.equal(res.status, 404);
    });
});


describe('GET /groups', () => {
    it('lists every group', async () => {
        const res = await call('GET', '/groups');
        assert.equal(res.status, 200);
        assert.deepEqual(res.body.map(g => g.name), ['Book Club']);
    });
});


describe('PATCH /groups/:id', () => {
    it('lets a group admin edit the name, description and theme', async () => {
        const res = await call('PATCH', `/groups/${ids.groupId}`, {
            actorEmail: 'alice@test.com', name: 'Readers', description: 'new', theme: '#000000',
        });
        assert.equal(res.status, 200);
        assert.equal(res.body.group.name, 'Readers');
        assert.equal(res.body.group.theme, '#000000');
    });

    it('refuses a non-admin with 403', async () => {
        const res = await call('PATCH', `/groups/${ids.groupId}`, { actorEmail: 'bob@test.com', name: 'Mine' });
        assert.equal(res.status, 403);
    });

    it('answers 404 for a malformed id instead of crashing', async () => {
        const res = await call('PATCH', '/groups/not-an-id', { actorEmail: 'alice@test.com', name: 'x' });
        assert.equal(res.status, 404);
    });

    it('rejects a theme that isn\'t a colour, an age limit outside 0 to 120, and a long name, with 400', async () => {
        const url = `/groups/${ids.groupId}`;
        assert.equal((await call('PATCH', url, { actorEmail: 'alice@test.com', theme: 'red' })).status, 400);
        assert.equal((await call('PATCH', url, { actorEmail: 'alice@test.com', ageLimit: 121 })).status, 400);
        assert.equal((await call('PATCH', url, { actorEmail: 'alice@test.com', ageLimit: -5 })).status, 400);
        assert.equal((await call('PATCH', url, { actorEmail: 'alice@test.com', name: 'n'.repeat(51) })).status, 400);
    });

    it('refuses a name another group already has with 409', async () => {
        await addGroup('Chess', 'carol@test.com');
        const res = await call('PATCH', `/groups/${ids.groupId}`, { actorEmail: 'alice@test.com', name: 'CHESS' });
        assert.equal(res.status, 409);
    });

    it('raising the age limit removes members under it, but never an admin', async () => {
        // kid is 10. alice is the admin and old enough anyway, bob is old enough, kid is not
        await ctx.db.collection('groups').updateOne({ _id: new ObjectId(ids.groupId) },
            { $push: { memberEmails: 'kid@test.com' } });
        const res = await call('PATCH', `/groups/${ids.groupId}`, { actorEmail: 'alice@test.com', ageLimit: 18 });
        assert.equal(res.status, 200);
        assert.deepEqual(res.body.booted, ['kid@test.com']);
        assert.deepEqual(res.body.group.memberEmails, ['alice@test.com', 'bob@test.com']);
    });
});


describe('DELETE /groups/:id', () => {
    it('only lets the super admin delete a group', async () => {
        const res = await call('DELETE', `/groups/${ids.groupId}?actorEmail=alice@test.com`);
        assert.equal(res.status, 403);
    });

    it('deletes the group along with its rooms and their messages', async () => {
        await ctx.db.collection('messages').insertOne({
            channelId: new ObjectId(ids.channelId), sender: 'bob@test.com', body: 'hi', imageUrl: '', at: '',
        });
        const res = await call('DELETE', `/groups/${ids.groupId}?actorEmail=super@test.com`);
        assert.equal(res.status, 200);
        assert.equal(await ctx.db.collection('groups').countDocuments(), 0);
        assert.equal(await ctx.db.collection('channels').countDocuments(), 0);
        assert.equal(await ctx.db.collection('messages').countDocuments(), 0);
    });

    it('answers 404 for a group that doesn\'t exist', async () => {
        const res = await call('DELETE', `/groups/${missingId}?actorEmail=super@test.com`);
        assert.equal(res.status, 404);
    });
});


describe('GET /groups/:id/members', () => {
    it('lists each member\'s email, name and picture, and nothing else from their profile', async () => {
        const res = await call('GET', `/groups/${ids.groupId}/members`);
        assert.equal(res.status, 200);
        assert.deepEqual(res.body.map(m => m.email).sort(), ['alice@test.com', 'bob@test.com']);
        // profiles are private, so no date of birth, bio, role or password
        assert.deepEqual(Object.keys(res.body[0]).sort(), ['avatarUrl', 'email', 'username']);
    });

    it('answers 404 for an unknown or malformed group id', async () => {
        assert.equal((await call('GET', `/groups/${missingId}/members`)).status, 404);
        assert.equal((await call('GET', '/groups/nope/members')).status, 404);
    });
});


describe('joining a group (group-join requests)', () => {
    const ask = (email, groupId = ids.groupId) =>
        call('POST', '/requests', { type: 'group-join', requestedBy: email, groupId });
    const memberEmails = async () =>
        (await ctx.db.collection('groups').findOne({ _id: new ObjectId(ids.groupId) })).memberEmails;

    it('has no direct join route, so the approval can\'t be skipped', async () => {
        const res = await call('POST', `/groups/${ids.groupId}/members`, { email: 'carol@test.com', actorEmail: 'carol@test.com' });
        assert.equal(res.status, 404);
        assert.ok(!(await memberEmails()).includes('carol@test.com'));
    });

    it('waits for an admin, and approving it adds them to the group', async () => {
        const res = await ask('carol@test.com');
        assert.equal(res.status, 201);
        assert.equal(res.body.status, 'pending');
        assert.equal(res.body.summary, 'Join "Book Club"');
        assert.ok(!(await memberEmails()).includes('carol@test.com'));

        assert.equal((await call('POST', `/requests/${res.body._id}/approve`, { actorEmail: 'alice@test.com' })).status, 200);
        assert.ok((await memberEmails()).includes('carol@test.com'));
    });

    it('goes to the group\'s admins, not the super admin, and only they can approve it', async () => {
        const res = await ask('carol@test.com');
        assert.equal((await call('POST', `/requests/${res.body._id}/approve`, { actorEmail: 'super@test.com' })).status, 403);
        assert.equal((await call('POST', `/requests/${res.body._id}/approve`, { actorEmail: 'bob@test.com' })).status, 403);
        const queue = await call('GET', `/requests?scope=group&groupId=${ids.groupId}`);
        assert.deepEqual(queue.body.map(r => r.type), ['group-join']);
    });

    it('rejects someone too young, or with no date of birth, straight away with the reason', async () => {
        await ctx.db.collection('groups').updateOne({ _id: new ObjectId(ids.groupId) }, { $set: { ageLimit: 18 } });
        const kid = await ask('kid@test.com');
        assert.equal(kid.status, 201);
        assert.equal(kid.body.status, 'rejected');
        assert.match(kid.body.reason, /at least 18/);
        const carol = await ask('carol@test.com');
        assert.equal(carol.body.status, 'rejected');
        assert.match(carol.body.reason, /date of birth/);

        // nothing waits for an admin, and neither of them is in the group
        assert.equal((await call('GET', `/requests?status=pending&groupId=${ids.groupId}`)).body.length, 0);
        assert.ok(!(await memberEmails()).includes('kid@test.com'));
    });

    it('refuses a member 409, the super admin 403, a second request 409, and someone banned 403', async () => {
        assert.equal((await ask('bob@test.com')).status, 409);
        assert.equal((await ask('super@test.com')).status, 403);
        await ask('carol@test.com');
        assert.equal((await ask('carol@test.com')).status, 409);
        await call('POST', `/groups/${ids.groupId}/bans`, { email: 'kid@test.com', actorEmail: 'alice@test.com' });
        assert.equal((await ask('kid@test.com')).status, 403);
    });

    it('re-checks the age limit at approval, in case it was raised while the request waited', async () => {
        const res = await ask('kid@test.com');      // fine while the group has no limit
        await ctx.db.collection('groups').updateOne({ _id: new ObjectId(ids.groupId) }, { $set: { ageLimit: 18 } });
        assert.equal((await call('POST', `/requests/${res.body._id}/approve`, { actorEmail: 'alice@test.com' })).status, 409);
        assert.ok(!(await memberEmails()).includes('kid@test.com'));
    });

    it('closes the request if they are banned from the group before it\'s approved', async () => {
        const res = await ask('carol@test.com');
        await call('POST', `/groups/${ids.groupId}/bans`, { email: 'carol@test.com', actorEmail: 'alice@test.com' });
        const request = await ctx.db.collection('requests').findOne({ _id: new ObjectId(res.body._id) });
        assert.equal(request.status, 'rejected');
    });

    it('answers 404 for a group that doesn\'t exist', async () => {
        assert.equal((await ask('carol@test.com', missingId)).status, 404);
    });
});


describe('DELETE /groups/:id/members/:email', () => {
    it('lets a member leave', async () => {
        const res = await call('DELETE', `/groups/${ids.groupId}/members/bob@test.com?actorEmail=bob@test.com`);
        assert.equal(res.status, 200);
        assert.ok(!res.body.memberEmails.includes('bob@test.com'));
    });

    it('lets an admin remove a member, but not a member remove someone else', async () => {
        assert.equal((await call('DELETE', `/groups/${ids.groupId}/members/alice@test.com?actorEmail=bob@test.com`)).status, 403);
        assert.equal((await call('DELETE', `/groups/${ids.groupId}/members/bob@test.com?actorEmail=alice@test.com`)).status, 200);
    });

    it('never leaves a group with no admin', async () => {
        const res = await call('DELETE', `/groups/${ids.groupId}/members/alice@test.com?actorEmail=alice@test.com`);
        assert.equal(res.status, 409);
    });

    it('answers 404 for someone who isn\'t a member', async () => {
        const res = await call('DELETE', `/groups/${ids.groupId}/members/carol@test.com?actorEmail=alice@test.com`);
        assert.equal(res.status, 404);
    });
});


describe('POST /groups/:id/bans', () => {
    it('bans a member from the group, and they can\'t rejoin', async () => {
        const res = await call('POST', `/groups/${ids.groupId}/bans`, {
            email: 'bob@test.com', actorEmail: 'alice@test.com', reason: 'spam',
        });
        assert.equal(res.status, 200);
        assert.ok(!res.body.memberEmails.includes('bob@test.com'));
        assert.ok(res.body.bannedEmails.includes('bob@test.com'));
        assert.equal((await call('POST', '/requests', { type: 'group-join', requestedBy: 'bob@test.com', groupId: ids.groupId })).status, 403);
    });

    it('refuses a non-admin with 403, the last admin with 409, and a repeat ban with 409', async () => {
        const url = `/groups/${ids.groupId}/bans`;
        assert.equal((await call('POST', url, { email: 'alice@test.com', actorEmail: 'bob@test.com' })).status, 403);
        assert.equal((await call('POST', url, { email: 'alice@test.com', actorEmail: 'alice@test.com' })).status, 409);
        await call('POST', url, { email: 'bob@test.com', actorEmail: 'alice@test.com' });
        assert.equal((await call('POST', url, { email: 'bob@test.com', actorEmail: 'alice@test.com' })).status, 409);
    });

    it('needs the email of a real account: 400 without one, 404 for an unknown one', async () => {
        const url = `/groups/${ids.groupId}/bans`;
        assert.equal((await call('POST', url, { actorEmail: 'alice@test.com' })).status, 400);
        assert.equal((await call('POST', url, { email: 'nobody@test.com', actorEmail: 'alice@test.com' })).status, 404);
    });
});


describe('DELETE /groups/:id/bans/:email', () => {
    it('lifts a group ban so the user can ask to join again, and only an admin can do it', async () => {
        await call('POST', `/groups/${ids.groupId}/bans`, { email: 'bob@test.com', actorEmail: 'alice@test.com' });
        const url = `/groups/${ids.groupId}/bans/bob@test.com`;
        assert.equal((await call('DELETE', `${url}?actorEmail=carol@test.com`)).status, 403);
        assert.equal((await call('DELETE', `${url}?actorEmail=alice@test.com`)).status, 200);
        assert.equal((await call('POST', '/requests', { type: 'group-join', requestedBy: 'bob@test.com', groupId: ids.groupId })).status, 201);
    });
});


describe('POST /groups/:id/admins', () => {
    it('lets an admin promote a member', async () => {
        const res = await call('POST', `/groups/${ids.groupId}/admins`, { email: 'bob@test.com', actorEmail: 'alice@test.com' });
        assert.equal(res.status, 200);
        assert.deepEqual(res.body.adminEmails, ['alice@test.com', 'bob@test.com']);
    });

    it('refuses a non-admin 403, a non-member 404 and an existing admin 409', async () => {
        const url = `/groups/${ids.groupId}/admins`;
        assert.equal((await call('POST', url, { email: 'bob@test.com', actorEmail: 'bob@test.com' })).status, 403);
        assert.equal((await call('POST', url, { email: 'carol@test.com', actorEmail: 'alice@test.com' })).status, 404);
        assert.equal((await call('POST', url, { email: 'alice@test.com', actorEmail: 'alice@test.com' })).status, 409);
    });

    it('promotes someone once even if it\'s clicked twice at once', async () => {
        const both = await Promise.all([1, 2].map(() =>
            call('POST', `/groups/${ids.groupId}/admins`, { email: 'bob@test.com', actorEmail: 'alice@test.com' })));
        assert.deepEqual(both.map(r => r.status).sort(), [200, 409]);
        const group = await ctx.db.collection('groups').findOne({ _id: new ObjectId(ids.groupId) });
        assert.deepEqual(group.adminEmails, ['alice@test.com', 'bob@test.com']);
    });
});


describe('DELETE /groups/:id/admins/:email', () => {
    it('won\'t demote the last admin, but will once there is another', async () => {
        const url = `/groups/${ids.groupId}/admins/alice@test.com?actorEmail=alice@test.com`;
        assert.equal((await call('DELETE', url)).status, 409);
        await call('POST', `/groups/${ids.groupId}/admins`, { email: 'bob@test.com', actorEmail: 'alice@test.com' });
        const res = await call('DELETE', url);
        assert.equal(res.status, 200);
        assert.deepEqual(res.body.adminEmails, ['bob@test.com']);
        assert.ok(res.body.memberEmails.includes('alice@test.com'));   // stepping down keeps you a member
    });

    it('answers 404 when the target isn\'t an admin', async () => {
        const res = await call('DELETE', `/groups/${ids.groupId}/admins/bob@test.com?actorEmail=alice@test.com`);
        assert.equal(res.status, 404);
    });

    it('still leaves one admin when two admins demote each other at the same moment', async () => {
        await call('POST', `/groups/${ids.groupId}/admins`, { email: 'bob@test.com', actorEmail: 'alice@test.com' });
        const both = await Promise.all([
            call('DELETE', `/groups/${ids.groupId}/admins/bob@test.com?actorEmail=alice@test.com`),
            call('DELETE', `/groups/${ids.groupId}/admins/alice@test.com?actorEmail=bob@test.com`),
        ]);
        // exactly one goes through. the other is refused, either by the atomic filter (409) or, if it
        // arrived after the first had finished, because its sender is no longer an admin (403)
        assert.equal(both.filter(r => r.status === 200).length, 1);
        const group = await ctx.db.collection('groups').findOne({ _id: new ObjectId(ids.groupId) });
        assert.equal(group.adminEmails.length, 1);
    });
});


describe('GET /channels', () => {
    it('lists all rooms, or one group\'s, and a malformed group id gives an empty list', async () => {
        assert.equal((await call('GET', '/channels')).body.length, 1);
        const one = await call('GET', `/channels?groupId=${ids.groupId}`);
        assert.deepEqual(one.body.map(c => c.name), ['General']);
        const bad = await call('GET', '/channels?groupId=nonsense');
        assert.equal(bad.status, 200);
        assert.deepEqual(bad.body, []);
    });
});


describe('POST /channels', () => {
    it('lets a group admin create a room', async () => {
        const res = await call('POST', '/channels', { groupId: ids.groupId, name: 'Fantasy', actorEmail: 'alice@test.com' });
        assert.equal(res.status, 201);
        assert.equal(res.body.name, 'Fantasy');
    });

    it('makes a plain member propose it instead, 403', async () => {
        const res = await call('POST', '/channels', { groupId: ids.groupId, name: 'Fantasy', actorEmail: 'bob@test.com' });
        assert.equal(res.status, 403);
    });

    it('rejects a duplicate name in the same group 409, and missing fields 400', async () => {
        assert.equal((await call('POST', '/channels', { groupId: ids.groupId, name: 'general', actorEmail: 'alice@test.com' })).status, 409);
        assert.equal((await call('POST', '/channels', { groupId: ids.groupId, actorEmail: 'alice@test.com' })).status, 400);
    });

    it('treats a blank name as missing, and refuses one over 50 characters, with 400', async () => {
        assert.equal((await call('POST', '/channels', { groupId: ids.groupId, name: '   ', actorEmail: 'alice@test.com' })).status, 400);
        assert.equal((await call('POST', '/channels', { groupId: ids.groupId, name: 'r'.repeat(51), actorEmail: 'alice@test.com' })).status, 400);
    });
});


describe('PATCH /channels/:id', () => {
    it('lets a group admin rename a room', async () => {
        const res = await call('PATCH', `/channels/${ids.channelId}`, { name: 'Lobby', actorEmail: 'alice@test.com' });
        assert.equal(res.status, 200);
        assert.equal(res.body.name, 'Lobby');
    });

    it('refuses a non-admin 403, an empty name 400, and a clashing name 409', async () => {
        await call('POST', '/channels', { groupId: ids.groupId, name: 'Fantasy', actorEmail: 'alice@test.com' });
        const url = `/channels/${ids.channelId}`;
        assert.equal((await call('PATCH', url, { name: 'Mine', actorEmail: 'bob@test.com' })).status, 403);
        assert.equal((await call('PATCH', url, { name: ' ', actorEmail: 'alice@test.com' })).status, 400);
        assert.equal((await call('PATCH', url, { name: 'FANTASY', actorEmail: 'alice@test.com' })).status, 409);
    });
});


describe('DELETE /channels/:id', () => {
    it('refuses a non-admin with 403', async () => {
        const res = await call('DELETE', `/channels/${ids.channelId}?actorEmail=bob@test.com`);
        assert.equal(res.status, 403);
    });

    it('deletes the room and every message in it', async () => {
        await ctx.db.collection('messages').insertOne({
            channelId: new ObjectId(ids.channelId), sender: 'bob@test.com', body: 'hi', imageUrl: '', at: '',
        });
        const res = await call('DELETE', `/channels/${ids.channelId}?actorEmail=alice@test.com`);
        assert.equal(res.status, 200);
        assert.equal(await ctx.db.collection('channels').countDocuments(), 0);
        assert.equal(await ctx.db.collection('messages').countDocuments(), 0);
    });

    it('answers 404 for a room that doesn\'t exist', async () => {
        assert.equal((await call('DELETE', `/channels/${missingId}?actorEmail=alice@test.com`)).status, 404);
    });
});


describe('GET /requests', () => {
    it('splits the super admin\'s queue from a group admin\'s with scope', async () => {
        await raise('carol@test.com', 'group-create', { payload: { name: 'Chess' } });
        await raise('bob@test.com', 'channel-create', { groupId: ids.groupId, payload: { name: 'Fantasy' } });

        const superQueue = await call('GET', '/requests?scope=super');
        const groupQueue = await call('GET', `/requests?scope=group&groupId=${ids.groupId}`);
        assert.deepEqual(superQueue.body.map(r => r.type), ['group-create']);
        assert.deepEqual(groupQueue.body.map(r => r.type), ['channel-create']);
    });

    it('filters to one user\'s own requests with requestedBy', async () => {
        await raise('carol@test.com', 'group-create', { payload: { name: 'Chess' } });
        await raise('bob@test.com', 'channel-create', { groupId: ids.groupId, payload: { name: 'Fantasy' } });
        const res = await call('GET', '/requests?requestedBy=bob@test.com');
        assert.equal(res.body.length, 1);
        assert.equal(res.body[0].requestedBy, 'bob@test.com');
    });
});


describe('POST /requests', () => {
    it('raises a pending group-create request', async () => {
        const res = await call('POST', '/requests', { type: 'group-create', requestedBy: 'carol@test.com', payload: { name: 'Chess' } });
        assert.equal(res.status, 201);
        assert.equal(res.body.status, 'pending');
        assert.equal(res.body.summary, 'Create group "Chess"');
    });

    it('stops the super admin raising requests, 403', async () => {
        const res = await call('POST', '/requests', { type: 'group-create', requestedBy: 'super@test.com', payload: { name: 'X' } });
        assert.equal(res.status, 403);
    });

    it('refuses a second pending request for the same group name, 409', async () => {
        await raise('carol@test.com', 'group-create', { payload: { name: 'Chess' } });
        const res = await call('POST', '/requests', { type: 'group-create', requestedBy: 'bob@test.com', payload: { name: 'chess' } });
        assert.equal(res.status, 409);
    });

    it('only lets a member propose a room, and only an admin ask to delete the group', async () => {
        assert.equal((await call('POST', '/requests', {
            type: 'channel-create', requestedBy: 'carol@test.com', groupId: ids.groupId, payload: { name: 'X' },
        })).status, 403);
        assert.equal((await call('POST', '/requests', {
            type: 'group-delete', requestedBy: 'bob@test.com', groupId: ids.groupId,
        })).status, 403);
    });

    it('needs a reason to report a user, and won\'t ban a group\'s only admin', async () => {
        await call('POST', `/groups/${ids.groupId}/admins`, { email: 'bob@test.com', actorEmail: 'alice@test.com' });
        await addGroup('Chess', 'carol@test.com');   // carol is Chess's only admin
        await ctx.db.collection('groups').updateOne(     // and a member of Book Club, so alice can report her
            { _id: new ObjectId(ids.groupId) }, { $push: { memberEmails: 'carol@test.com' } });
        assert.equal((await call('POST', '/requests', {
            type: 'user-ban', requestedBy: 'alice@test.com', groupId: ids.groupId, payload: { email: 'carol@test.com' },
        })).status, 400);
        assert.equal((await call('POST', '/requests', {
            type: 'user-ban', requestedBy: 'alice@test.com', groupId: ids.groupId, payload: { email: 'carol@test.com', reason: 'spam' },
        })).status, 409);
    });

    it('only lets an admin report someone in, or banned from, their own group', async () => {
        const res = await call('POST', '/requests', {
            type: 'user-ban', requestedBy: 'alice@test.com', groupId: ids.groupId, payload: { email: 'carol@test.com', reason: 'spam' },
        });
        assert.equal(res.status, 404);
    });

    it('rejects group details that are too long or not valid, and a long room name, with 400', async () => {
        const group = details => call('POST', '/requests', { type: 'group-create', requestedBy: 'carol@test.com', payload: details });
        assert.equal((await group({ name: 'n'.repeat(51) })).status, 400);
        assert.equal((await group({ name: 'Chess', theme: 'red' })).status, 400);
        assert.equal((await group({ name: 'Chess', ageLimit: 200 })).status, 400);
        assert.equal((await group({ name: 'Chess', description: 'd'.repeat(501) })).status, 400);
        assert.equal((await call('POST', '/requests', {
            type: 'channel-create', requestedBy: 'bob@test.com', groupId: ids.groupId, payload: { name: 'r'.repeat(51) },
        })).status, 400);
    });

    it('rejects an unknown type with 400', async () => {
        assert.equal((await call('POST', '/requests', { type: 'make-me-admin', requestedBy: 'bob@test.com' })).status, 400);
    });
});


describe('POST /requests/:id/approve', () => {
    it('approving a group-create creates the group with the requester as admin', async () => {
        const id = await raise('carol@test.com', 'group-create', { payload: { name: 'Chess' } });
        const res = await call('POST', `/requests/${id}/approve`, { actorEmail: 'super@test.com' });
        assert.equal(res.status, 200);
        assert.equal(res.body.status, 'approved');
        const chess = await ctx.db.collection('groups').findOne({ name: 'Chess' });
        assert.deepEqual(chess.adminEmails, ['carol@test.com']);
    });

    it('only the super admin can approve a system request, and not twice', async () => {
        const id = await raise('carol@test.com', 'group-create', { payload: { name: 'Chess' } });
        assert.equal((await call('POST', `/requests/${id}/approve`, { actorEmail: 'alice@test.com' })).status, 403);
        assert.equal((await call('POST', `/requests/${id}/approve`, { actorEmail: 'super@test.com' })).status, 200);
        assert.equal((await call('POST', `/requests/${id}/approve`, { actorEmail: 'super@test.com' })).status, 409);
    });

    it('nobody can approve their own request', async () => {
        await call('POST', `/groups/${ids.groupId}/admins`, { email: 'bob@test.com', actorEmail: 'alice@test.com' });
        const id = await raise('bob@test.com', 'channel-create', { groupId: ids.groupId, payload: { name: 'Fantasy' } });
        assert.equal((await call('POST', `/requests/${id}/approve`, { actorEmail: 'bob@test.com' })).status, 403);
    });

    it('a group admin approving a room proposal creates the room', async () => {
        const id = await raise('bob@test.com', 'channel-create', { groupId: ids.groupId, payload: { name: 'Fantasy' } });
        assert.equal((await call('POST', `/requests/${id}/approve`, { actorEmail: 'alice@test.com' })).status, 200);
        assert.ok(await ctx.db.collection('channels').findOne({ name: 'Fantasy' }));
    });

    it('re-checks the name at approval time, in case it was taken while the request waited', async () => {
        const id = await raise('carol@test.com', 'group-create', { payload: { name: 'Chess' } });
        await addGroup('Chess', 'bob@test.com');   // someone else got there first
        const res = await call('POST', `/requests/${id}/approve`, { actorEmail: 'super@test.com' });
        assert.equal(res.status, 409);
        assert.equal(await ctx.db.collection('groups').countDocuments({ name: 'Chess' }), 1);
        // refused, so it goes back to pending rather than staying claimed
        const request = await ctx.db.collection('requests').findOne({ _id: new ObjectId(id) });
        assert.equal(request.status, 'pending');
    });

    it('carries a request out once even if it\'s approved twice at the same moment', async () => {
        const id = await raise('bob@test.com', 'channel-create', { groupId: ids.groupId, payload: { name: 'Fantasy' } });
        const both = await Promise.all([1, 2].map(() =>
            call('POST', `/requests/${id}/approve`, { actorEmail: 'alice@test.com' })));
        assert.deepEqual(both.map(r => r.status).sort(), [200, 409]);
        assert.equal(await ctx.db.collection('channels').countDocuments({ name: 'Fantasy' }), 1);
    });

    it('lets only one of an approve and a reject sent at the same moment go through', async () => {
        const id = await raise('bob@test.com', 'channel-create', { groupId: ids.groupId, payload: { name: 'Fantasy' } });
        const [approve, reject] = await Promise.all([
            call('POST', `/requests/${id}/approve`, { actorEmail: 'alice@test.com' }),
            call('POST', `/requests/${id}/reject`, { actorEmail: 'alice@test.com', reason: 'no' }),
        ]);
        assert.deepEqual([approve.status, reject.status].sort(), [200, 409]);

        // and what's stored matches whichever won
        const request = await ctx.db.collection('requests').findOne({ _id: new ObjectId(id) });
        const room = await ctx.db.collection('channels').findOne({ name: 'Fantasy' });
        assert.equal(request.status, approve.status === 200 ? 'approved' : 'rejected');
        assert.equal(Boolean(room), approve.status === 200);
    });

    it('approving a user-ban deletes the account, removes them from groups, and blocks the email for good', async () => {
        const id = await raise('alice@test.com', 'user-ban', {
            groupId: ids.groupId, payload: { email: 'bob@test.com', reason: 'abuse' },
        });
        assert.equal((await call('POST', `/requests/${id}/approve`, { actorEmail: 'super@test.com' })).status, 200);

        assert.equal(await ctx.db.collection('users').findOne({ email: 'bob@test.com' }), null);
        const group = await ctx.db.collection('groups').findOne({ _id: new ObjectId(ids.groupId) });
        assert.ok(!group.memberEmails.includes('bob@test.com'));
        assert.equal((await call('POST', '/register', { email: 'bob@test.com', password: 'secret1' })).status, 403);
    });

    it('approving a group-delete removes the group and its rooms', async () => {
        const id = await raise('alice@test.com', 'group-delete', { groupId: ids.groupId });
        assert.equal((await call('POST', `/requests/${id}/approve`, { actorEmail: 'super@test.com' })).status, 200);
        assert.equal(await ctx.db.collection('groups').countDocuments(), 0);
        assert.equal(await ctx.db.collection('channels').countDocuments(), 0);
    });

    it('banning a user closes their pending requests, so a deleted account can\'t end up admin of a new group', async () => {
        const groupReq = await raise('bob@test.com', 'group-create', { payload: { name: 'Chess' } });
        const banReq = await raise('alice@test.com', 'user-ban', {
            groupId: ids.groupId, payload: { email: 'bob@test.com', reason: 'abuse' },
        });
        await call('POST', `/requests/${banReq}/approve`, { actorEmail: 'super@test.com' });

        const closed = await ctx.db.collection('requests').findOne({ _id: new ObjectId(groupReq) });
        assert.equal(closed.status, 'rejected');
        assert.match(closed.reason, /banned/);
        assert.equal((await call('POST', `/requests/${groupReq}/approve`, { actorEmail: 'super@test.com' })).status, 409);
        assert.equal(await ctx.db.collection('groups').countDocuments({ name: 'Chess' }), 0);
    });

    it('won\'t carry out a request whose requester no longer has an account', async () => {
        const id = await raise('carol@test.com', 'group-create', { payload: { name: 'Chess' } });
        await ctx.db.collection('users').deleteOne({ email: 'carol@test.com' });
        assert.equal((await call('POST', `/requests/${id}/approve`, { actorEmail: 'super@test.com' })).status, 409);
        assert.equal(await ctx.db.collection('groups').countDocuments({ name: 'Chess' }), 0);
    });

    it('deleting a group closes its other pending requests, but approves the deletion itself', async () => {
        const proposal = await raise('bob@test.com', 'channel-create', { groupId: ids.groupId, payload: { name: 'Spoilers' } });
        const deletion = await raise('alice@test.com', 'group-delete', { groupId: ids.groupId });
        await call('POST', `/requests/${deletion}/approve`, { actorEmail: 'super@test.com' });

        const find = id => ctx.db.collection('requests').findOne({ _id: new ObjectId(id) });
        assert.equal((await find(proposal)).status, 'rejected');
        assert.equal((await find(proposal)).reason, 'The group was deleted');
        assert.equal((await find(deletion)).status, 'approved');
    });

    it('answers 404 for a request that doesn\'t exist', async () => {
        assert.equal((await call('POST', `/requests/${missingId}/approve`, { actorEmail: 'super@test.com' })).status, 404);
    });
});


describe('POST /requests/:id/reject', () => {
    it('needs a reason, and stores it for the requester to see', async () => {
        const id = await raise('carol@test.com', 'group-create', { payload: { name: 'Chess' } });
        assert.equal((await call('POST', `/requests/${id}/reject`, { actorEmail: 'super@test.com' })).status, 400);

        const res = await call('POST', `/requests/${id}/reject`, { actorEmail: 'super@test.com', reason: 'already one' });
        assert.equal(res.status, 200);
        assert.equal(res.body.status, 'rejected');
        assert.equal(res.body.reason, 'already one');
        assert.equal(await ctx.db.collection('groups').countDocuments({ name: 'Chess' }), 0);
    });

    it('has the same authority check as approve', async () => {
        const id = await raise('bob@test.com', 'channel-create', { groupId: ids.groupId, payload: { name: 'Fantasy' } });
        assert.equal((await call('POST', `/requests/${id}/reject`, { actorEmail: 'carol@test.com', reason: 'no' })).status, 403);
        assert.equal((await call('POST', `/requests/${id}/reject`, { actorEmail: 'alice@test.com', reason: 'no' })).status, 200);
    });
});


describe('GET /bans', () => {
    it('lists permanently banned accounts', async () => {
        await ctx.db.collection('banned').insertOne({ email: 'gone@test.com', reason: 'spam' });
        const res = await call('GET', '/bans');
        assert.equal(res.status, 200);
        assert.deepEqual(res.body.map(b => b.email), ['gone@test.com']);
    });
});


describe('GET /audit', () => {
    it('records every change, newest first, and filters by type', async () => {
        await call('PUT', '/users/carol@test.com', { actorEmail: 'carol@test.com', bio: 'hi' });
        await call('PATCH', `/groups/${ids.groupId}`, { actorEmail: 'alice@test.com', description: 'x' });

        const all = await call('GET', '/audit');
        assert.equal(all.status, 200);
        assert.deepEqual(all.body.map(e => e.type), ['Group Edited', 'Profile Updated']);

        const edited = await call('GET', '/audit?type=' + encodeURIComponent('Profile Updated'));
        assert.deepEqual(edited.body.map(e => e.actor), ['carol@test.com']);
    });
});


describe('GET /audit paging', () => {
    it('sends a page at a time, newest first, and the next page with skip', async () => {
        const at = i => new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString();
        await ctx.db.collection('audit').insertMany(
            [0, 1, 2, 3, 4].map(i => ({ at: at(i), type: 'Test', actor: 'x', detail: `entry ${i}` })));

        const first = await call('GET', '/audit?limit=2');
        const second = await call('GET', '/audit?limit=2&skip=2');
        assert.deepEqual(first.body.map(e => e.detail), ['entry 4', 'entry 3']);
        assert.deepEqual(second.body.map(e => e.detail), ['entry 2', 'entry 1']);
    });
});


describe('GET /audit/types', () => {
    it('lists the distinct types in the log, sorted', async () => {
        await call('PATCH', `/groups/${ids.groupId}`, { actorEmail: 'alice@test.com', description: 'x' });
        await call('PUT', '/users/carol@test.com', { actorEmail: 'carol@test.com', bio: 'hi' });
        await call('PUT', '/users/carol@test.com', { actorEmail: 'bob@test.com', bio: 'x' });   // refused, so not logged
        const res = await call('GET', '/audit/types');
        assert.deepEqual(res.body, ['Group Edited', 'Profile Updated']);
    });
});


describe('profile pictures', () => {
    const onDisk = url => fs.existsSync(ctx.UPLOAD_DIR + '/' + url.split('/').pop());

    it('stores your own picture, returns it on the account, and serves the file', async () => {
        const res = await uploadAvatar(ctx.base, { email: 'bob@test.com' });
        assert.equal(res.status, 200);
        ctx.uploaded.push(res.body.avatarUrl);
        assert.match(res.body.avatarUrl, /^\/uploads\/[0-9a-f-]{36}\.png$/);
        assert.equal(res.body.password, undefined);

        assert.equal((await call('GET', '/users/bob@test.com')).body.avatarUrl, res.body.avatarUrl);
        assert.equal((await fetch(ctx.base + res.body.avatarUrl)).status, 200);
    });

    it('deletes the old file when the picture is replaced', async () => {
        const first = await uploadAvatar(ctx.base, { email: 'bob@test.com' });
        const second = await uploadAvatar(ctx.base, { email: 'bob@test.com' });
        ctx.uploaded.push(first.body.avatarUrl, second.body.avatarUrl);
        assert.ok(!onDisk(first.body.avatarUrl));
        assert.ok(onDisk(second.body.avatarUrl));
    });

    it('refuses someone else\'s picture with 403 and doesn\'t leave the file on disk', async () => {
        const before = fs.readdirSync(ctx.UPLOAD_DIR).length;
        const res = await uploadAvatar(ctx.base, { email: 'bob@test.com', actorEmail: 'alice@test.com' });
        assert.equal(res.status, 403);
        assert.equal(fs.readdirSync(ctx.UPLOAD_DIR).length, before);
    });

    it('refuses a file that isn\'t an allowed image with 400', async () => {
        const res = await uploadAvatar(ctx.base, {
            email: 'bob@test.com', bytes: Buffer.from('<svg/>'), type: 'image/svg+xml', name: 'x.svg',
        });
        assert.equal(res.status, 400);
    });

    it('removes the picture and its file, own account only', async () => {
        const up = await uploadAvatar(ctx.base, { email: 'bob@test.com' });
        ctx.uploaded.push(up.body.avatarUrl);
        assert.equal((await call('DELETE', '/users/bob@test.com/avatar?actorEmail=alice@test.com')).status, 403);

        const res = await call('DELETE', '/users/bob@test.com/avatar?actorEmail=bob@test.com');
        assert.equal(res.status, 200);
        assert.equal(res.body.avatarUrl, '');
        assert.ok(!onDisk(up.body.avatarUrl));
    });
});


describe('POST /uploads', () => {
    it('stores an image from a member and serves it back with nosniff', async () => {
        const res = await uploadImage(ctx.base, { email: 'bob@test.com', channelId: ids.channelId });
        assert.equal(res.status, 201);
        ctx.uploaded.push(res.body.imageUrl);
        assert.match(res.body.imageUrl, /^\/uploads\/[0-9a-f-]{36}\.png$/);    // a random name, not "pic.png"

        const served = await fetch(ctx.base + res.body.imageUrl);
        assert.equal(served.status, 200);
        assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
    });

    it('refuses a non-member with 403 and doesn\'t leave the file on disk', async () => {
        const before = fs.readdirSync(ctx.UPLOAD_DIR).length;
        const res = await uploadImage(ctx.base, { email: 'carol@test.com', channelId: ids.channelId });
        assert.equal(res.status, 403);
        assert.equal(fs.readdirSync(ctx.UPLOAD_DIR).length, before);
    });

    it('refuses a file that isn\'t one of the four image types with 400', async () => {
        const res = await uploadImage(ctx.base, {
            email: 'bob@test.com', channelId: ids.channelId,
            bytes: Buffer.from('<svg onload="alert(1)"/>'), type: 'image/svg+xml', name: 'x.svg',
        });
        assert.equal(res.status, 400);
    });

    it('refuses anything over 5 MB with 413', async () => {
        const res = await uploadImage(ctx.base, {
            email: 'bob@test.com', channelId: ids.channelId, bytes: Buffer.alloc(5 * 1024 * 1024 + 1),
        });
        assert.equal(res.status, 413);
    });
});


describe('GET /uploads/:file', () => {
    it('answers 404 for a file that was never uploaded', async () => {
        const res = await fetch(`${ctx.base}/uploads/nothing-here.png`);
        assert.equal(res.status, 404);
    });
});
