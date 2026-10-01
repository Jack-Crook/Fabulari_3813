
# Fabulari: Phase 2

**Name:** Jack Crook
**Student number:** s5389490
**Workshop Time:** Thursday 9am
**Repository:** https://github.com/Jack-Crook/Fabulari_3813

## 1. Specifications and Requirements

 The requirements for this assignment came from the assignment brief, the Week 2 client briefing, and the Spec Update documents that answered questions from the students. The client is the course convenor, and the brief was deliberately incomplete, so some requirements only exist in those Q&A answers.

  Phase 1 covered the UI and user management, stored in JSON files. Phase 2 is the full app: data in MongoDB, real-time chat over socket.io with text and image messages, a live presence list, the request and approval flow, hashed passwords and profile pictures.

### Requirements implemented in Phase 2

| # | Requirement | Where it's enforced |
|---|---|---|
| R1 | Users self-register. There is no admin-created account path. | `POST /register`, `Register` component |
| R2 | Email is the unique identifier for an account, compared case-insensitively. | `normaliseEmail()` on every route; unique index on `users.email` |
| R3 | Exactly one super admin, and nobody can create that account through the UI. The first account on an empty system becomes it. | `POST /register` (`countDocuments() === 0`) |
| R4 | Passwords are hashed and never sent back to the client. **(Phase 2)** | bcrypt in `POST /register` and `PUT /users/:email`; `publicUser()` strips the password from every response |
| R5 | A user can edit every profile field except email, and only their own profile. | `PUT /users/:email` (403 for anyone else); `Profile` component |
| R6 | A user can set and remove a profile picture, shown in the navbar and next to their chat messages. **(Phase 2)** | `POST` / `DELETE /users/:email/avatar`; `Profile`, `Navbar`, `ChatRoom` |
| R7 | Profiles are private. Other members only see a name and picture. | `GET /groups/:id/members` returns only email, username and picture |
| R8 | Every group is visible to every user, whatever their age. | `GET /groups`; Discover on `UserDashboard`; `GroupView` |
| R9 | Joining is refused if the user is under the group's age limit, or has no date of birth set. | `POST /groups/:id/members` → `ageProblem()` (403) |
| R10 | The age limit belongs to the group and covers every room in it. | `groups.ageLimit`; `joinRoom` only admits members |
| R11 | Raising the age limit removes members who no longer meet it (never an admin). | `PATCH /groups/:id` (`$pullAll`, returns `booted`) |
| R12 | A group is created by request to the super admin, with title, description, age limit and colour supplied up front. The requester becomes its first admin. | `POST /requests` (`group-create`) → `POST /requests/:id/approve` → `createGroupRecord()`. There is no direct create route. |
| R13 | A group admin can edit name, description, theme and age limit at any time, without a request. | `PATCH /groups/:id` (403 for non-admins) |
| R14 | A group admin cannot delete their group; they request it from the super admin. This is also how a group with no working admin is disbanded. | `POST /requests` (`group-delete`); `DELETE /groups/:id` is super admin only |
| R15 | A group always has at least one admin, even when two admins act at the same moment. | 409 on the last admin in `DELETE /groups/:id/members/:email`, `DELETE /groups/:id/admins/:email`, `POST /groups/:id/bans` and ban reports. The rule is also inside the database update's filter (`'adminEmails.1': { $exists: true }`), so two simultaneous demotions can't both pass it |
| R16 | An admin can promote any member, and demote another admin or step down while another admin remains. | `POST` / `DELETE /groups/:id/admins` |
| R17 | No limit on how many admins a group has, or how many groups one person admins. | `adminEmails[]` lives on the group, not the user |
| R18 | The group's theme colour extends into its chat rooms, with text that stays readable on any colour. | `ChatRoom` `theme()` / `ink()`; `theme.ts` `readableInk()` |
| R19 | Members propose rooms; a group admin approves or rejects them. | `POST /requests` (`channel-create`); `POST /channels` refuses non-admins (403) |
| R20 | A group admin can rename or delete a room. A group can have any number of rooms, including none. | `PATCH` / `DELETE /channels/:id` |
| R21 | A rejected request must include a reason. | `POST /requests/:id/reject` (400 without one) |
| R22 | A pending request cannot be cancelled. | No route sets a request back or deletes it |
| R23 | Users can see their own pending requests and their past rejected ones, with the reason. | `GET /requests?requestedBy=`; `Profile` |
| R24 | Nobody approves or rejects their own request, and the super admin cannot raise one. | `approve` / `reject` (403); `POST /requests` (403 for the super admin) |
| R25 | Only the super admin bans a user system-wide, and only from a group admin's report with a reason, about someone in (or banned from) that admin's group. | `POST /requests` (`user-ban`) → approve deletes the account and strips it from every group |
| R26 | A system-wide ban is permanent: the email can never register again. | `banned` collection; `POST /register` (403) |
| R27 | A user who is a group's only admin can't be banned until a replacement admin is assigned. | `POST /requests` (`user-ban`, 409), re-checked at approval |
| R28 | Group-level bans are separate from system bans and can be lifted. A group admin sees their group's member list and banned list. | `POST` / `DELETE /groups/:id/bans`; `AdminDashboard` |
| R29 | The super admin sees every permanently banned account, and an audit log filterable by type in date order. | `GET /bans`, `GET /audit?type=`, `GET /audit/types`; `logAudit()` on every change |
| R30 | The super admin cannot be a member or admin of any group. | `POST /groups/:id/members` (409) |
| R31 | Real-time text messages. **(Phase 2)** | socket.io `sendMessage` → `newMessage`; `ChatService` |
| R32 | Image messages. **(Phase 2)** | `POST /uploads` then `sendMessage { imageUrl }` |
| R33 | A live list of who is in the room, plus a notification when someone joins or leaves, both by display name. **(Phase 2)** | In-memory `presence` map; `presence`, `userJoined`, `userLeft` events; `ChatRoom` sidebar and mobile strip |
| R34 | An indicator in chat when the sender is that group's admin. | `ChatRoom.isAdmin()` |
| R35 | Only members can enter or post in a room. Membership is re-checked on every message, and someone removed or banned, or whose room or group is deleted, is taken out of the room straight away and stops receiving its messages. **(Phase 2)** | `joinRoom`, `sendMessage`, `POST /uploads` (403); `removeFromRooms()` and the `removedFromRoom` event |
| R36 | Data persists in MongoDB. **(Phase 2)** | 7 collections, loaded by `seed.js` |
| R37 | Input is checked on the server: names up to 50 characters, descriptions and bios up to 500, messages up to 2000; a theme must be a hex colour; an age limit is a whole number from 0 to 120; a date of birth can't be in the future. | `groupDetailsProblem()`, `dobProblem()` and the `MAX_*` limits in `server.js` (400); `maxlength` on the matching inputs |
| R38 | Two requests at the same moment can't break a rule: a member is added once, a request is carried out once, and an approve and a reject can't both succeed. | Conditional updates (the check is in the update's filter), requests claimed with `status: 'pending'`, unique indexes, and a 409 from the error handler |

### Assumptions and known limitations

- **Identity is self-asserted.** Every REST write route takes an `actorEmail` from the client and checks the rules against it (admin of this group, your own profile, super admin only). The rules are enforced on the server, but the server trusts the email it is given. There are no sessions or tokens, so a modified client could claim to be someone else. The fix would be a JWT issued at login and checked in Express middleware and in the socket handshake.
- **The socket join trusts the email too.** `joinRoom` checks that the email is a member of the group, but takes the email from the client. Once joined, `sendMessage` takes the sender from the socket's own join, never from the payload, so a message can't be posted under a different name than the one that joined.
- **Read routes are open.** `GET /users`, `/groups`, `/requests`, `/audit` and `/bans` don't check who is asking. The route guards stop the wrong pages showing, not the data being fetched.
- **Route guards are not security.** They read the session from localStorage, which the user can edit. They only control navigation. The real checks are on the server.
- **No HTTPS.** Passwords are hashed with bcrypt before they are stored, but they still cross the network in plain text on localhost.
- **Login timing.** When the email doesn't exist, login answers before running bcrypt, which is faster than a wrong password. The message is identical, but the timing could show whether an account exists.
- **Single server.** Presence is kept in memory, and uploaded images are stored on the server's disk in `uploads/`. Both would need changing (a Redis adapter, object storage) to run more than one server.
- **Profile pictures in chat** are loaded when you enter a room, so a picture someone changes while you're in the room shows after a refresh.

Fixed since Phase 1: passwords are no longer stored in plain text, data is in MongoDB instead of JSON files (no more lost writes when two requests overlap), image messages exist, and several write routes that had no permission check now have one.

## 2. API Documentation

The server is Express 5.2 in server.js at the repo root, on port 3000. Data is in MongoDB through the official mongodb driver (7.6), database fabulari. socket.io 4.8 runs on the same HTTP server as Express. Uploads use multer 2.4, and passwords are hashed with bcrypt 6.0 at cost 10.

Conventions
- Every error response is JSON: { "error": "..." }.
- Emails are trimmed and lowercased on every route (normaliseEmail()), so Test@Test.com and test@test.com are the same account.
- Ids are Mongo ObjectIds, sent as 24-character hex strings. An id from a URL goes through toObjectId() first. A malformed id would make the ObjectId constructor throw, so the function returns null instead and the route answers 404 rather than crashing with a 500.
- Users never have a password in a response. Every route that returns a user goes through publicUser().
- A route that checks something and then changes it does both in one database operation: the check goes in the update's filter, so it only matches if the check still holds. Two requests at the same moment can't both pass, and the second gets a 409.

### REST endpoints

Identity comes from `actorEmail`: in the body for POST/PUT/PATCH, and in the query string for DELETE. See the limitations in §1.

| Method | Path | Purpose | Status codes |
|---|---|---|---|
| GET | `/` | Health check. Returns `"Fabulari API running"`. | 200 |
| POST | `/register` | Create an account from `{ email, password, username?, dob? }`. The first account on an empty system becomes the super admin. | 201 `{ message, email, role }` · 400 missing field, invalid email, password under 6 characters, display name over 50, invalid or future date of birth · 403 email is permanently banned · 409 email already registered (also when two registrations arrive at once) |
| POST | `/login` | Check `{ email, password }` against the bcrypt hash. | 200 the user without the password · 400 missing field · 401 wrong email or password (the same answer for both) |
| GET | `/users` | Every account, for the super admin's members panel. | 200 |
| GET | `/users/:email` | One account, for the profile page. | 200 · 404 |
| PUT | `/users/:email` | Edit your own `username`, `dob`, `bio`, `password`. Email and role can't be changed. Sending nothing saves and logs nothing. | 200 · 400 empty or over-50 username, invalid or future date, bio over 500, short password · 403 not your own account · 404 |
| POST | `/users/:email/avatar` | Upload your own profile picture (multipart: `actorEmail`, then `image`). Replaces and deletes the old file. | 200 the updated user · 400 not PNG/JPEG/GIF/WebP · 403 not your own account (the file is deleted) · 404 · 413 over 5 MB |
| DELETE | `/users/:email/avatar` | Remove your profile picture and its file. | 200 · 403 · 404 |
| GET | `/groups` | Every group. | 200 |
| PATCH | `/groups/:id` | A group admin edits name, description, theme or age limit. Raising the age limit removes under-age members, and takes them out of the group's rooms. | 200 `{ group, booted }` · 400 empty or over-50 name, description over 500, age limit not 0 to 120, theme not a hex colour · 403 not an admin of this group · 404 · 409 name already taken |
| DELETE | `/groups/:id` | Delete a group, its rooms, their messages and images, close its pending requests, and take everyone out of its rooms. | 200 · 403 not the super admin · 404 |
| GET | `/groups/:id/members` | Email, username and picture of each member, for the chat room. | 200 · 404 |
| POST | `/groups/:id/members` | Join a group (`email` must equal `actorEmail`). | 200 · 400 no email · 403 joining for someone else, banned from this group, under the age limit or no date of birth · 404 user or group · 409 already a member (also two joins at once), or the super admin |
| DELETE | `/groups/:id/members/:email` | Leave a group, or an admin removes a member. Takes them out of the group's rooms. | 200 · 403 neither yourself nor an admin · 404 group, or not a member · 409 the only admin, or the group changed at the same time |
| POST | `/groups/:id/bans` | A group admin bans a member from this group (removes them, takes them out of its rooms, and blocks rejoining). | 200 · 400 no email · 403 not an admin · 404 group or user · 409 the only admin, already banned, or the group changed at the same time |
| DELETE | `/groups/:id/bans/:email` | Lift a group-level ban. | 200 · 403 not an admin · 404 |
| POST | `/groups/:id/admins` | Promote a member to admin. | 200 · 403 not an admin · 404 group, or the user isn't a member · 409 already an admin (also a double click) |
| DELETE | `/groups/:id/admins/:email` | Demote an admin, or step down yourself. | 200 · 403 not an admin · 404 group, or the user isn't an admin · 409 the last admin (also when two admins demote each other at once) |
| GET | `/channels` | All rooms, or one group's with `?groupId=`. A malformed id returns `[]`. | 200 |
| POST | `/channels` | A group admin creates a room directly. | 201 · 400 missing or blank name, name over 50 · 403 not an admin (members propose instead) · 404 group · 409 name already used in this group |
| PATCH | `/channels/:id` | A group admin renames a room. | 200 · 400 empty name, or over 50 · 403 · 404 · 409 name clash |
| DELETE | `/channels/:id` | A group admin deletes a room, its messages and their images, and takes anyone in it out. | 200 · 403 · 404 |
| GET | `/requests` | Filter by `status`, `type`, `groupId`, `requestedBy`, and `scope=super` or `scope=group`. Newest first. | 200 |
| POST | `/requests` | Raise a `group-create`, `group-delete`, `channel-create` or `user-ban` request, each validated for its type. | 201 · 400 missing type or name, unknown type, name over 50, invalid group details (description, age limit, theme), ban report with no reason, reporting yourself · 403 super admin raising, not an admin or member of the group, target is the super admin · 404 user, group or target, target not in (or banned from) the group · 409 duplicate pending request, name taken, target is a group's only admin |
| POST | `/requests/:id/approve` | Carry the request out: create the group, delete the group, create the room, or permanently ban the user. The request is claimed first (one update from `pending` to `approved`), so it's carried out once; if a re-check then refuses it, it goes back to pending. | 200 · 403 your own request, or not the right authority for this type · 404 request, actor or group · 409 already actioned (including a second approve at the same moment), requester no longer exists, name or room taken since, target became a group's only admin |
| POST | `/requests/:id/reject` | Reject with a required reason, which the requester sees on their profile. | 200 · 400 no reason · 403 your own request, or not the right authority · 404 · 409 already actioned (including an approve at the same moment) |
| GET | `/bans` | Every permanently banned account. | 200 |
| GET | `/audit` | The audit log, newest first, optionally `?type=`. | 200 |
| GET | `/audit/types` | The distinct types in the log, sorted, for the filter dropdown. | 200 |
| POST | `/uploads` | Upload a chat image (multipart: `email`, `channelId`, then `image`). Members only. | 201 `{ imageUrl }` · 400 wrong type or unreadable upload · 403 not a member (the file is deleted) · 413 over 5 MB |
| GET | `/uploads/:file` | **Not a route handler**: `express.static` serving uploaded images with `X-Content-Type-Options: nosniff`. | 200 · 404 |
| ANY | *any route* | The Express 5 error handler, for anything a route didn't answer itself. | 400 a body that isn't valid JSON · 409 a duplicate key from a unique index (two requests racing past a route's own check) · 500 anything else, e.g. Mongo down |

### Socket.io events

The socket server runs on the same HTTP server as Express. The client opens one connection for the whole app (`ChatService`) and reuses it for every room.

`sendMessage` carries no sender. The server remembers who joined on each socket and uses that, so the payload can't be used to post as someone else. `newMessage` uses `io.to(room)`, which includes the sender, so the sender's own message comes from the server like everyone else's. `userJoined` uses `socket.to(room)`, which excludes the sender, because you don't need to be told that you joined.

| Direction | Event | Payload / ack |
|---|---|---|
| client → server | `joinRoom` | `{ channelId, email }`. Ack: `{ history, present }` (the last 50 messages oldest first, plus who is in the room), or `{ error }` for a bad id, an unknown room, or a non-member. Leaves any previous room first. |
| client → server | `sendMessage` | `{ body, imageUrl? }`, with no sender. Ack: `{ ok: true }`, or `{ error }` if not joined, empty, over 2000 characters, the image wasn't issued by `/uploads`, or the sender is no longer a member. |
| client → server | `leaveRoom` | No payload. Removes this socket from the room and presence. |
| client → server | `disconnect` | Built in (closed tab, lost network). Handled the same as `leaveRoom`. |
| server → client | `newMessage` | The saved message `{ _id, channelId, sender, body, imageUrl, at }`, sent to **everyone** in the room including the sender (`io.to`). |
| server → client | `presence` | `string[]` of the emails in the room, sent to everyone in it after every join and leave. |
| server → client | `userJoined` | `{ email }`, sent to everyone **except** the joiner (`socket.to`). |
| server → client | `userLeft` | `{ email }`, sent to everyone still in the room. |
| server → client | `removedFromRoom` | `{ reason }`, sent to someone the server has just taken out of their room: they were removed or banned from the group, or the room or group was deleted. The page shows the reason and hides the message box. |

### Data structures

Group admin is not a role on the user. It is stored on the group as `adminEmails[]`, because one person can be an admin of one group and an ordinary member of another. The only role on the user is `user` or `super`, since there is exactly one super admin. Members and bans are stored the same way, as email arrays on the group, and updated with `$push` / `$pull` so two changes at once don't overwrite each other. Each update also carries its own condition in the filter ("not already a member", "a second admin exists"), so two changes at once can't both pass a check.

| Collection | Key fields |
|---|---|
| `users` | `email` (the identifier, `_id` unused), `password` (bcrypt hash), `role` (`'user'` or `'super'`), `username`, `dob`, `bio`, `avatarUrl`, `createdAt` |
| `groups` | `_id`, `name`, `description`, `ageLimit` (0 = none), `theme` (hex), `adminEmails[]`, `memberEmails[]`, `bannedEmails[]` |
| `channels` | `_id`, `groupId` (ObjectId of its group), `name` |
| `messages` | `_id`, `channelId` (ObjectId), `sender` (email), `body`, `imageUrl` (`''` if no image), `at` (ISO) |
| `requests` | `_id`, `type`, `status` (`pending` / `approved` / `rejected`), `summary`, `requestedBy`, `groupId` (null for `group-create`), `payload`, `createdAt`, `resolvedAt`, `resolvedBy`, `reason` |
| `audit` | `_id`, `at` (ISO), `type`, `actor`, `detail` |
| `banned` | `email`, `reason`, `reportedBy`, `bannedAt`, `bannedBy` |

### Indexes

All six are created by `ensureIndexes()` in `server.js` every time the server starts, so the database enforces them even if it was never seeded. Creating one that already exists does nothing.

| Collection | Index | Purpose |
|---|---|---|
| `users` | `{ email: 1 }` unique | The lookup in `/login`, `/register` and every route that checks an actor. Also guarantees one account per email if two registrations race: the second insert fails, and the error handler turns that into a 409. |
| `banned` | `{ email: 1 }` unique | The permanent-ban check in `/register`. |
| `groups` | `{ name: 1 }` unique, collation `{ locale: 'en', strength: 2 }` | Case-insensitive uniqueness enforced by the database itself. `nameTaken()` gives the friendly 409; the index is the guarantee. |
| `requests` | `{ status: 1, createdAt: -1 }` | Both request queues: `GET /requests?status=pending`, newest first. |
| `audit` | `{ type: 1, at: -1 }` | `GET /audit?type=`, newest first. |
| `messages` | `{ channelId: 1, at: 1 }` | Room history in `joinRoom` (`find({ channelId }).sort({ at: -1 }).limit(50)`). |

### Error handling

Each route checks its own inputs and answers with a 4xx status and `{ error }`. For anything unexpected (for example MongoDB being down), there is one Express 5 error handler at the bottom of `server.js`. Express 5 passes a rejected promise from an async route to that handler, so the routes don't need a try/catch each, and the client gets a 500 instead of a request that hangs. Two errors get a better answer than a 500: a body that isn't valid JSON is a 400, and a duplicate key from a unique index is a 409. The socket handlers can't use it, so each one has its own try/catch and answers through the ack.

## 3. Angular Components, Services and Models

The client is Angular 22 in `client/`. Every component is standalone (no NgModules) and imports what it uses directly. The app is zoneless, so Angular only redraws when a signal changes or a template event fires. Anything set inside an HTTP `subscribe` or a socket callback is therefore a `signal()`. Form fields bound with `[(ngModel)]` stay plain properties, because typing is a DOM event and already triggers a redraw. Missing this caused a bug in Phase 1 where data loaded but never appeared on screen.

### Components

| Component | Purpose |
|---|---|
| `App` (`app-root`) | The root. Its template is only `<router-outlet>`. |
| `Navbar` (`app-navbar`) | Shared header imported by every signed-in page. It shows the Dashboard link, a Group Admin link on a group you admin, a Super Admin link for the super admin, and an account menu (avatar or initial) with your name, email, Profile and Logout. The menu closes on an outside click, Escape or navigation. |
| `Login` (`app-login`) | Email and password form. Stores the session in localStorage and goes to the dashboard. Ignores a double submit. |
| `Register` (`app-register`) | Signup with optional display name and date of birth. Tells the first account it became the super admin. |
| `UserDashboard` (`app-user-dashboard`) | My Groups (with Leave), Discover with live search and Join, the group-request form, and your pending requests. The super admin sees All Groups instead. |
| `Profile` (`app-profile`) | View and edit your own profile (everything except email), upload or remove a profile picture, the groups you admin, and your pending and rejected requests with reasons. |
| `GroupView` (`app-group-view`) | A group's banner in its theme colour and its rooms. Members open rooms and propose new ones; non-members see a Join button and locked rooms. |
| `ChatRoom` (`app-chat-room`) | The live chat. Room list, messages with avatars, names, admin tags and dates, text and image composer, the presence list (a strip on mobile) and join/leave notices, both by display name. If the server takes you out of the room, it shows why and hides the message box. Holds no chat state of its own. |
| `AdminDashboard` (`app-admin-dashboard`) | One group's admin page: edit settings, request deletion, add, rename and delete rooms, promote, demote, remove, group-ban or report members, lift bans, and approve or reject room proposals. Irreversible actions ask for confirmation. Stepping down goes back to the group page, and leaving goes to the dashboard. |
| `SuperAdminDashboard` (`app-super-admin-dashboard`) | Four panels: the pending request queue (approve, or reject with a reason; bans and group deletions ask for confirmation), every account, permanently banned accounts, and the audit log with a type filter. |
| `Autofocus` (directive, `[appAutofocus]`) | Focuses the Cancel button when a confirm box appears, so keyboard focus isn't lost and Enter backs out. |

### Services

| Service | Owns |
|---|---|
| `Auth` (`auth.ts`) | Who is signed in: the localStorage session, exposed as the `session` signal so the navbar redraws when it changes. Also register, login, and the users endpoints: fetch, update profile, upload or remove a profile picture. |
| `GroupService` (`group.ts`) | Groups and channels: list, edit, join, leave or remove, ban and unban, promote and demote, the member list for chat, and room create, rename and delete. |
| `RequestService` (`request.ts`) | The request queue (raise, approve, reject, with filters and `scope`), the audit log and its types, and the permanent ban list. |
| `ChatService` (`chat.ts`) | The single socket.io connection for the whole app, and the live chat state as signals: `messages`, `present`, `notice`, `error`, `removed`. Join, send, leave, rejoin after a reconnect, the chat image upload, and being taken out of a room by the server. |
| `theme.ts` *(functions, not a service)* | `contrastRatio()` and `readableInk()`: the WCAG contrast maths that picks dark or light text for any group theme. |

### Models

| Model | File | Note |
|---|---|---|
| `AppUser` | `auth.ts` | One account as the server sends it: email, role, username, dob, bio, avatarUrl, createdAt. Never a password. |
| `LoginResponse` | `auth.ts` | `AppUser` plus `message`. |
| `StoredUser` | `auth.ts` | What's kept in localStorage: email, role, username and optional avatarUrl. Everything else is fetched fresh. |
| `ProfileChanges` | `auth.ts` | The editable fields, all optional. No email and no role. |
| `Group` | `group.ts` | `_id`, name, description, ageLimit, theme, and the admin, member and banned email arrays. |
| `Channel` | `group.ts` | `_id`, groupId, name. |
| `GroupMember` | `group.ts` | email, username, avatarUrl. Only what the chat room needs, because profiles are private. |
| `GroupEditResponse` | `group.ts` | `{ group, booted }`: the saved group and anyone the new age limit removed. |
| `GroupChanges` | `group.ts` | The fields a group admin can edit, all optional. |
| `RequestType` | `request.ts` | `'group-create' \| 'group-delete' \| 'channel-create' \| 'user-ban'` |
| `AppRequest` | `request.ts` | One request. `payload` is type-specific; `reason` is only set on a rejection. |
| `AuditEntry` | `request.ts` | `_id`, at, type, actor, detail. |
| `BannedUser` | `request.ts` | email, reason, reportedBy, bannedAt, bannedBy. |
| `ChatMessage` | `chat.ts` | `_id`, channelId, sender, body, imageUrl, at. |
| `RoomNotice` | `chat.ts` | `{ email, event }`, where event is `'joined'` or `'left'`. The page turns the email into a display name. |
| `JoinResult` | `chat.ts` | Internal. The `joinRoom` ack: `history` and `present`, or `error`. |

### Route guards

The guards only control which pages render. They read localStorage, so they are not security. Every action is checked again on the server.

| Guard | Rule |
|---|---|
| `authGuard` | Someone is signed in (an email in localStorage); otherwise redirect to `/login`. Synchronous boolean. |
| `superAdminGuard` | The stored role is `'super'`; otherwise redirect to `/user-dashboard`. Synchronous boolean. |
| `groupAdminGuard` | Your email is in the `adminEmails` of the group in `:groupId`; otherwise redirect to `/user-dashboard`. **Returns an Observable**, because group admin isn't stored on the user and the group has to be fetched first. |

### Routes

Every page route has a `title` (for example `Dashboard | Fabulari`), so the browser tab and screen readers name the page after each navigation.

| Path | Component | Guard |
|---|---|---|
| `''` | none | Redirects to `/login` |
| `login` | `Login` | none |
| `register` | `Register` | none |
| `user-dashboard` | `UserDashboard` | `authGuard` |
| `profile` | `Profile` | `authGuard` |
| `groups/:id` | `GroupView` | `authGuard` |
| `groups/:groupId/channels/:channelId` | `ChatRoom` | `authGuard` (the server checks membership when joining) |
| `admin-dashboard/:groupId` | `AdminDashboard` | `authGuard`, then `groupAdminGuard` |
| `super-admin-dashboard` | `SuperAdminDashboard` | `authGuard`, then `superAdminGuard` |
| `**` | none | Any unknown URL redirects to `/login`. It's last because the first matching route wins. |

## 4. Design Documents

The wireframes from Phase 1 are in [`design/`](design/): six desktop screens and two mobile ones. The built app follows them, with the changes listed in the table below. Most changes come from the spec updates (for example the super admin can't ban directly, so there is no Ban button) or from features added in Phase 2 (chat, presence, images, profile pictures).

### Wireframes

All in [`design/`](design/). The last column lists what changed in the built app.

| Screen | Desktop | Mobile | Changed since the wireframe |
|---|---|---|---|
| Login | [`Login_wireframe.png`](design/Login_wireframe.png) | [`Mobile_login.PNG`](design/Mobile_login.PNG) | Register link; error and success messages |
| User dashboard | [`User_Dashboard_Wireframe.png`](design/User_Dashboard_Wireframe.png) | [`Mobile_dashboard.PNG`](design/Mobile_dashboard.PNG) | "Request Group" form instead of direct create; Leave buttons; pending requests; account menu replaces the bottom-left user card |
| Group / channel view | [`Group_Channel_view_wireframe.png`](design/Group_Channel_view_wireframe.png) | None | Propose-a-room form, proposed rooms list, Join bar and locked rooms for non-members |
| Chat room | [`In_chatroom_wireframe.png`](design/In_chatroom_wireframe.png) | None | Live presence list (a strip on mobile), join/leave notice, avatars, image attach and preview, dates on older messages, mobile Back link |
| Group admin | [`admin_view_wireframe.png`](design/admin_view_wireframe.png) | None | Editable settings, room management, promote/demote/remove/ban/report, banned list, room proposals instead of join requests, confirm boxes |
| Super admin | [`super_admin_wireframes.png`](design/super_admin_wireframes.png) | None | No Un-ban button and no direct Ban (the spec forbids both); approve/reject with reasons; audit type filter; confirm boxes |
| Profile | None | None | Not wireframed: edit form, profile picture, groups administered, pending and rejected requests |

### Responsive methodology

- Designed for desktop first, then reduced for phones with one breakpoint, `@media (max-width: 768px)`, in each page's CSS.
- The same components are used at both sizes; there are no separate mobile pages. Under 768px, side panels are hidden or stacked, for example the chat room hides the room list and the "Currently In" sidebar.
- Anything hidden on mobile has a replacement so nothing is lost: a presence strip under the chat banner and a Back link in the banner.
- The main buttons (the full width form buttons, the navbar links and account menu, the mobile Back link) are at least 44px tall. Buttons inside a row, like Approve, Join and Edit, are 32 to 36px, above the 24px minimum WCAG 2.2 AA sets, which the accessibility test checks.
- Nothing makes a page scroll sideways on a phone. Grid columns are `minmax(0, 1fr)` so long content can't widen them, long emails and links wrap, and the admin page's members table scrolls inside its own box. The accessibility test checks every page at 375px.

### Accessibility

- **Theme contrast.** The group's theme colour is used behind text in its banner and chat rooms, and an admin can pick any colour. The text colour (dark or white) is worked out from the theme using the WCAG contrast formula in `theme.ts`, so text stays readable on any theme. A unit test checks every seeded theme passes WCAG AA (4.5:1).
- **Contrast elsewhere.** All text meets 4.5:1. An axe scan found four places that didn't (the grey "optional" and "can't be changed" hints, the faded group description, the room pill's "Open", and sender names on your own messages). They were fixed and are now checked automatically.
- **Page structure.** Every page has one `<main>` and one `<h1>` (visually hidden on the dashboards, whose design has no title), the side panels are labelled `<aside>`s, and every route has its own page title.
- **Labels.** Every form input has a `<label>` or an `aria-label`, so screen readers can name it.
- **Messages are announced.** Errors use `role="alert"` and success messages use `role="status"`, including the chat join and leave notices. The chat's message list is `role="log"`, so a screen reader reads out each new message.
- **Keyboard.** All controls are real buttons and links. There is a visible `:focus-visible` outline. The account menu closes on Escape and returns focus to its button. Confirm boxes put focus on Cancel, so Enter backs out, and use `aria-describedby` so the question is read out. Boxes that scroll (the chat history, the super admin's lists, the members table on a phone) take keyboard focus, so they can be scrolled without a mouse.
- **Checked automatically.** `accessibility.cy.ts` runs axe-core (the engine behind browser accessibility audits) on every page at desktop and phone width, against WCAG 2.2 A and AA and axe's best-practice rules. It finds no violations.
- **Images.** The logo and chat images have alt text. Avatars use `alt=""` because the name is written next to them.

## 5. Testing

Three levels of automated testing:

- **Server integration tests** use Node's built-in test runner (`node --test`). Each test file starts the real server on a free port against a separate test database, then calls the routes over HTTP and the socket events with `socket.io-client`, checking status codes, responses and what was written to the database.
- **Client unit tests** use Vitest through Angular's `ng test`, with jsdom and TestBed. The HTTP backend is replaced with Angular's testing backend, so each test checks what a component or service requested and gives it a fixed reply. Shared setup (providers, sign in, data builders) is in `testing.ts`. No application code was changed to suit the tests.
- **End to end tests** use Cypress, against the real app, server and database (see below).

### Automated test suite

**Server: integration tests** (`test/`, run with `npm test` from the repo root, needs `mongod`)

| Spec file | Tests | Covers |
|---|---|---|
| `api.test.js`: auth and users | 20 | health check; a body that isn't JSON is a 400, not a 500; first account becomes super admin; bcrypt hash stored, never the password; email normalised; 400 on missing fields, bad email, short password, long display name, future date of birth; 403 on a banned email; the same email registered twice at once makes one account and a 409; identical 401 for wrong password and unknown email; password never returned; profile edit own-only (403), role not editable, changed password re-hashed, long bio refused, an empty edit saves and logs nothing |
| `api.test.js`: profile pictures | 5 | your own picture stored with a random file name, returned on the account and served; replacing it deletes the old file; someone else's picture 403 with no file left on disk; SVG refused (400); remove clears it and deletes the file, own account only |
| `api.test.js`: groups | 32 | list; edit admin-only (403); malformed id is 404, not 500; theme, age limit and name length checked (400); a name another group has (409); raising the age limit boots under-age members but never an admin; delete super-admin-only and cascades rooms and messages; member list returns only email, name and picture; join, already-in and super admin (409), joining for someone else (403), too young or no date of birth (403); three joins at once add the member once; leave and remove, removing a non-member is 404; last admin can't be removed, banned or demoted (409); a ban needs a real account (400, 404); group ban blocks rejoin, lifting it allows it; promote and demote, a double promote adds them once; two admins demoting each other at once still leaves one admin |
| `api.test.js`: channels | 10 | list all / by group, malformed group id gives `[]`; admin creates, member gets 403 (must propose); duplicate name in a group (409); a blank or over-long name (400); rename rules (403, 400, 409); delete admin-only and removes its messages |
| `api.test.js`: requests | 25 | `scope` splits the super admin and group admin queues; `requestedBy` filter; super admin can't raise requests (403); duplicate pending name (409); invalid or over-long group and room details (400); member-only proposals, admin-only deletion requests; ban report needs a reason (400), only for someone in the admin's group (404), and won't target a group's only admin (409); approve carries out all four types; nobody approves their own (403); can't action twice (409); name re-checked at approval time (409), and the request goes back to pending; two approves at once carry it out once; an approve and a reject at once can't both succeed; approved ban deletes the account and blocks re-registering; a ban closes the banned user's pending requests; a request from a deleted account can't be approved (409); deleting a group closes its other pending requests; reject needs a reason (400) and has the same authority check |
| `api.test.js`: bans and audit | 3 | banned list; audit newest first and filterable by type; distinct sorted types, refused actions not logged |
| `api.test.js`: uploads | 5 | member upload gets a random file name and is served with `nosniff`; non-member 403 and the file is removed from disk; SVG refused (400); over 5 MB refused (413); unknown file 404 |
| `sockets.test.js` | 18 | members only can join; bad or unknown room refused; history and presence in the join ack; `userJoined` to others but not the joiner; history replayed oldest first; must join before sending; empty and over-2000-character messages refused; `newMessage` reaches the sender too and is stored; sender taken from the join, not the payload; a sender removed from the group after joining is refused; uploaded image sends, an image url the server never issued is refused; a member removed by an admin is taken out of the room (`removedFromRoom`, presence updated) and stops receiving messages; deleting a room takes everyone out of it; leave and disconnect both send `userLeft` and update presence, no ghost entries |

**Result: 2 files, 118 tests, 118 passed, about 2s** (run six times in a row to check the tests that send requests at the same moment are stable).

**Client: unit tests** (`client/`, Vitest via `ng test`)

| Spec file | Tests | Covers |
|---|---|---|
| `auth.spec.ts` | 12 | register and login payloads, url-encoded email, profile update never sends email or role, session round trip through `localStorage`, super admin detection, logout; profile picture upload sends `actorEmail` before the file; remove sends `actorEmail`; the `session` signal updates on save and logout |
| `group.spec.ts` | 6 | `GroupService` call shapes: actor sent with edits, url-encoded member removal, promote POST vs demote DELETE, reason sent with a ban |
| `request.spec.ts` | 5 | empty filters dropped rather than sent, request payload, reject sends the reason, audit type only sent when chosen |
| `theme.spec.ts` | 7 | WCAG contrast end points (21:1 and 1:1), symmetric, short hex form, dark vs light ink choice, every seeded theme passes AA 4.5:1, safe fallback on a bad value |
| `guards.spec.ts` | 6 | `authGuard`, `superAdminGuard` and `groupAdminGuard`, each allowing and redirecting |
| `app.spec.ts` | 3 | root component creates and renders the router outlet; every page route has its own title |
| `login.spec.ts` | 4 | stores the user (including the picture) on success, shows the server's error, ignores a double submit |
| `register.spec.ts` | 5 | ordinary signup clears the form, first-account super admin message, server errors shown |
| `navbar.spec.ts` | 10 | Super Admin link only for the super admin; Group Admin link only on a group this user admins; account menu shows the initial, opens with name, email, Profile and Logout; shows the uploaded picture; closes on Escape and an outside click; logout clears the session and goes to login |
| `user-dashboard.spec.ts` | 7 | My Groups / Discover split, super admin view, search filter, group request instead of create, age-limit rejection and last-admin 409 surfaced |
| `group-view.spec.ts` | 11 | admin / member / non-member recognised, propose a room instead of creating it, 409 surfaced, pending proposals listed; non-member gets a Join button and locked rooms; joining sends `actorEmail` and unlocks the rooms; a refused join shows the server's reason; no Join button for the super admin |
| `chat-room.spec.ts` | 23 | joins the room in the url, admin indicator, theme colour and fallback, socket messages and presence rendered, send trims and clears, empty send blocked, image upload rules (type and 5 MB checked before uploading), image with and without text, members-only composer, leaves on destroy; sender's picture and display name shown, with initial and email fallbacks; presence list and join notice by display name; the message box goes when the server takes you out of the room; time only for today, date for older messages |
| `profile.spec.ts` | 10 | loads from the server not `localStorage`, age from date of birth, pending vs rejected requests, groups administered, blank password not sent, server errors shown; picture uploads and refreshes the session; bad type or over 5 MB refused before uploading; picture removed |
| `super-admin-dashboard.spec.ts` | 9 | only super admin request types fetched, audit refetched on filter change, approve, 400 on a rejection with no reason, request type labels; approving a ban asks first and says what it will do; a new group approves straight away |
| `admin-dashboard.spec.ts` | 17 | last admin flagged, actor sent with settings, booted members reported, deletion and ban go through requests, direct group ban, own-proposal 403 surfaced, rejection reason sent; deleting a room asks first and focuses Cancel; cancelling sends nothing; remove asks first, one box open per member; stepping down goes to the group page, leaving goes to the dashboard, demoting someone else stays put |

**Result: 15 files, 135 tests, 135 passed.**

**End to end: Cypress** (`client/cypress/e2e/`, run with `npx cypress run` from `client/`)

The two suites above test the halves separately. The client tests replace the server with a test backend, and the server tests call the API without a browser. The Cypress tests use neither shortcut. Cypress 16 drives a real browser against the running Angular app (`ng serve`, :4200). That talks to the real Express server (`npm start`, :3000), which reads and writes the real MongoDB. Nothing is mocked, so a passing test means the whole chain works: the form, the HTTP call or socket event, the route, the database write and what the page shows afterwards.

- **Setup goes through the API, the test goes through the UI.** `cypress/support/helpers.ts` creates the accounts, groups and rooms a test needs with `cy.request`, for example a group request approved by the super admin. A test then only clicks through the feature it is checking. The login form is tested in `auth.cy.ts`, and the other specs sign in with `visitAs()`. That logs in through the API and writes the same `localStorage` entry `login.ts` saves, before Angular starts.
- **Independent of the database.** Every account and group a run creates gets a timestamp in its name, so the suite gives the same result twice in a row without reseeding. The only fixture it relies on is the seeded super admin (`test@test.com`), because the spec allows exactly one and it can't be registered.
- **Two users in one chat.** Cypress drives a single browser, so the second person in a room is played from Node. The tasks in `cypress.config.ts` (`socketJoin`, `socketSend`, `socketReceived`, `socketLeave`) open a real connection with `socket.io-client`, the same library the Angular `ChatService` uses. A message sent in the browser has to reach that connection, and the reverse, so it is tested passing through the server, not just being drawn on the sender's screen.
- **Selectors are what the user sees.** Tests find elements by visible text, labels and `role="alert"` / `role="status"`, so they also check that errors and confirmations are announced to screen readers.

| Spec file | Tests | Covers |
|---|---|---|
| `auth.cy.ts` | 5 | register through the form; the same email twice (409); log in, land on the dashboard, password not in `localStorage`, navbar names the account; wrong password (401) stays on login with no session; logout from the account menu clears the session and the guard then bounces `/user-dashboard` |
| `guards.cy.ts` | 8 | signed out: `/user-dashboard`, `/profile`, `/super-admin-dashboard`, `/groups/:id` and an unknown URL all go to `/login`; an ordinary user is sent from the super admin dashboard and from another group's admin page back to their dashboard, with no Super Admin link; the super admin gets in |
| `groups.cy.ts` | 8 | request a group from the dashboard and see it awaiting approval; a second request for the same name refused; super admin approves; requester is its first admin with the age badge; an adult finds it in Discover and joins; a user under the 18+ limit is automatically refused with the reason; leaving; rejecting needs a reason (400 shown), and the requester sees that reason on their profile |
| `admin.cy.ts` | 9 | Manage link from the group page; edit settings, where raising the age limit removes the under-age member and says who; add, rename and delete a room, the delete confirm focusing Cancel and Cancel keeping the room; a member proposes a room and the admin approves it; promote and demote; group ban and lifting it; report for a permanent ban, super admin approves through the confirm step, account in the banned list and the email refused at registration; request group deletion, super admin approves, group gone and its page says "Group not found."; stepping down takes you back to the group page without the Manage link |
| `chat.cy.ts` | 7 | send a message with Enter, shown as your own with the admin indicator; history still there after a reload; a second user joins (presence list and "joined" notice, by display name), their message appears under their display name, the browser's message reaches them, and their disconnect shows "left" and removes them from the list; send an image (upload, preview, sent, loaded from the server); a member banned while in the room is told why and loses the message box; a non-member and the super admin are refused the room with no message box |
| `accessibility.cy.ts` | 8 | axe-core on every page (login with and without an error, register, dashboard with the request form open, group page as member and non-member, chat room with messages and a long link, group admin, super admin, profile viewing and editing) at 1280px and 375px: no WCAG 2.2 A/AA or best-practice violations, and nothing wider than the screen; every page has its own title |

**Result: 6 files, 45 tests, 45 passed, about 25s** (run repeatedly on 2026-10-01 to check it doesn't depend on the database).

**Total: 298 automated tests, all passing**: 118 server, 135 client, 45 end to end.

### Manual and integration testing

- Before the server test suite existed, a temporary Node script ran about 90 checks against the live server and database, covering every route and status code. It was not committed; the server test suite replaced it.
- The socket layer was checked by hand with two browser windows (one private, since two tabs share localStorage) logged in as two members of the same group: presence list, join and leave notices, and live messages in both windows.
- Every page was clicked through in the browser against the seeded MongoDB data after the migration.
- Before submitting, the running server was probed for race conditions by sending the same request several times at once (`Promise.all` from a Node script). That found real bugs: three simultaneous joins stored a member twice, two admins demoting each other at once left a group with no admin, and a double-clicked approve created two identical rooms. All three are fixed (the checks moved into the database updates) and now have tests.
- The same pass ran axe-core over every page, which found the contrast, landmark and scrolling problems listed in §4. Once they were fixed, that check became `accessibility.cy.ts`.

### Gaps

- The end to end tests only run in Cypress's built-in Electron browser, not in Firefox or Safari.
- The tests are run by hand. There is no CI running them on every push.
- The end to end tests rely on the seeded super admin account (`test@test.com`).
- axe can't judge everything, for example whether the reading order makes sense to a screen reader user. A manual pass with a real screen reader would still be worth doing.
- No load testing, for example many users in one room.

## 6. Git Strategy

- Every feature was built on its own `feature/*` branch and merged into `main` when it worked, for example `feature/socket`, `feature/image-messages`, `feature/pfp`, `feature/pre-submission-fixes` and `feature/cypress-e2e`.
- Phase 1 was submitted at `592a880`, tagged `phase-1-submission`. Phase 2 starts at `092dd60`, tagged `phase-2-start`.
- Commits are small and describe the change, so the history shows how the app was built.
- Mistake and lesson: the MongoDB migration was first written against an old copy of `server.js`, because I hadn't pulled `origin/main` first. I aborted the merge instead of forcing it, kept that work on a branch, and redid the migration on the current file. Now I pull before starting a branch.
