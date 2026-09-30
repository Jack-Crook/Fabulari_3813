
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
| R15 | A group always has at least one admin. | 409 on the last admin in `DELETE /groups/:id/members/:email`, `DELETE /groups/:id/admins/:email`, `POST /groups/:id/bans` and ban reports |
| R16 | An admin can promote any member, and demote another admin or step down while another admin remains. | `POST` / `DELETE /groups/:id/admins` |
| R17 | No limit on how many admins a group has, or how many groups one person admins. | `adminEmails[]` lives on the group, not the user |
| R18 | The group's theme colour extends into its chat rooms, with text that stays readable on any colour. | `ChatRoom` `theme()` / `ink()`; `theme.ts` `readableInk()` |
| R19 | Members propose rooms; a group admin approves or rejects them. | `POST /requests` (`channel-create`); `POST /channels` refuses non-admins (403) |
| R20 | A group admin can rename or delete a room. A group can have any number of rooms, including none. | `PATCH` / `DELETE /channels/:id` |
| R21 | A rejected request must include a reason. | `POST /requests/:id/reject` (400 without one) |
| R22 | A pending request cannot be cancelled. | No route sets a request back or deletes it |
| R23 | Users can see their own pending requests and their past rejected ones, with the reason. | `GET /requests?requestedBy=`; `Profile` |
| R24 | Nobody approves or rejects their own request, and the super admin cannot raise one. | `approve` / `reject` (403); `POST /requests` (403 for the super admin) |
| R25 | Only the super admin bans a user system-wide, and only from a group admin's report with a reason. | `POST /requests` (`user-ban`) → approve deletes the account and strips it from every group |
| R26 | A system-wide ban is permanent: the email can never register again. | `banned` collection; `POST /register` (403) |
| R27 | A user who is a group's only admin can't be banned until a replacement admin is assigned. | `POST /requests` (`user-ban`, 409), re-checked at approval |
| R28 | Group-level bans are separate from system bans and can be lifted. A group admin sees their group's member list and banned list. | `POST` / `DELETE /groups/:id/bans`; `AdminDashboard` |
| R29 | The super admin sees every permanently banned account, and an audit log filterable by type in date order. | `GET /bans`, `GET /audit?type=`, `GET /audit/types`; `logAudit()` on every change |
| R30 | The super admin cannot be a member or admin of any group. | `POST /groups/:id/members` (409) |
| R31 | Real-time text messages. **(Phase 2)** | socket.io `sendMessage` → `newMessage`; `ChatService` |
| R32 | Image messages. **(Phase 2)** | `POST /uploads` then `sendMessage { imageUrl }` |
| R33 | A live list of who is in the room, plus a notification when someone joins or leaves. **(Phase 2)** | In-memory `presence` map; `presence`, `userJoined`, `userLeft` events; `ChatRoom` sidebar and mobile strip |
| R34 | An indicator in chat when the sender is that group's admin. | `ChatRoom.isAdmin()` |
| R35 | Only members can enter or post in a room. Membership is re-checked on every message. **(Phase 2)** | `joinRoom`, `sendMessage`, `POST /uploads` (403) |
| R36 | Data persists in MongoDB. **(Phase 2)** | 7 collections, loaded by `seed.js` |

### Assumptions and known limitations

<!-- Write these up honestly. A stated limitation scores better than a hidden one,
     and you will be asked about them in the interview. The four that matter:

       - actorEmail is self-asserted on every REST write route. The rules are
         enforced, the identity is not. Contrast this with the socket layer, which
         does not have the hole - see §2.
       - GET /users, /groups, /requests, /audit, /bans are unauthenticated.
         Route guards stop the wrong pages rendering, not the data.
       - Passwords are hashed now, but there is no HTTPS, so the password still
         crosses the network in the clear. And login short-circuits before hashing
         when the email is unknown, which is measurably faster than a wrong
         password and leaks whether an account exists.
       - Route guards read localStorage, which the user owns. Navigation control,
         not security.

     Also note what you fixed since Phase 1 rather than only what is broken:
     plain-text passwords and the missing image messages are both closed. -->


## 2. API Documentation

The server is Express 5.2 in server.js at the repo root, on port 3000. Data is in MongoDB through the official mongodb driver (7.6), database fabulari. socket.io 4.8 runs on the same HTTP server as Express. Uploads use multer 2.4, and passwords are hashed with bcrypt 6.0 at cost 10.

Conventions
- Every error response is JSON: { "error": "..." }.
- Emails are trimmed and lowercased on every route (normaliseEmail()), so Test@Test.com and test@test.com are the same account.
- Ids are Mongo ObjectIds, sent as 24-character hex strings. An id from a URL goes through toObjectId() first. A malformed id would make the ObjectId constructor throw, so the function returns null instead and the route answers 404 rather than crashing with a 500.
- Users never have a password in a response. Every route that returns a user goes through publicUser().

### REST endpoints

<!-- 28 handlers. Verify with:
       grep -nE "^app\.(get|post|put|patch|delete)\(" server.js
     GET /uploads/:file is express.static, not a route of its own - list it at the
     bottom for completeness and say so. -->

Identity comes from `actorEmail`: in the body for POST/PUT/PATCH, and in the query string for DELETE. See the limitations in §1.

| Method | Path | Purpose | Status codes |
|---|---|---|---|
| GET | `/` | Health check. Returns `"Fabulari API running"`. | 200 |
| POST | `/register` | Create an account from `{ email, password, username?, dob? }`. The first account on an empty system becomes the super admin. | 201 `{ message, email, role }` · 400 missing field, invalid email, password under 6 characters · 403 email is permanently banned · 409 email already registered |
| POST | `/login` | Check `{ email, password }` against the bcrypt hash. | 200 the user without the password · 400 missing field · 401 wrong email or password (the same answer for both) |
| GET | `/users` | Every account, for the super admin's members panel. | 200 |
| GET | `/users/:email` | One account, for the profile page. | 200 · 404 |
| PUT | `/users/:email` | Edit your own `username`, `dob`, `bio`, `password`. Email and role can't be changed. | 200 · 400 empty username, invalid date, short password · 403 not your own account · 404 |
| POST | `/users/:email/avatar` | Upload your own profile picture (multipart: `actorEmail`, then `image`). Replaces and deletes the old file. | 200 the updated user · 400 not PNG/JPEG/GIF/WebP · 403 not your own account (the file is deleted) · 404 · 413 over 5 MB |
| DELETE | `/users/:email/avatar` | Remove your profile picture and its file. | 200 · 403 · 404 |
| GET | `/groups` | Every group. | 200 |
| PATCH | `/groups/:id` | A group admin edits name, description, theme or age limit. Raising the age limit removes under-age members. | 200 `{ group, booted }` · 400 empty name · 403 not an admin of this group · 404 · 409 name already taken |
| DELETE | `/groups/:id` | Delete a group, its rooms, their messages and images, and close its pending requests. | 200 · 403 not the super admin · 404 |
| GET | `/groups/:id/members` | Email, username and picture of each member, for the chat room. | 200 · 404 |
| POST | `/groups/:id/members` | Join a group (`email` must equal `actorEmail`). | 200 · 400 no email · 403 joining for someone else, banned from this group, under the age limit or no date of birth · 404 user or group · 409 already a member, or the super admin |
| DELETE | `/groups/:id/members/:email` | Leave a group, or an admin removes a member. | 200 · 403 neither yourself nor an admin · 404 · 409 the only admin |
| POST | `/groups/:id/bans` | A group admin bans a member from this group (removes them and blocks rejoining). | 200 · 403 not an admin · 404 · 409 the only admin, or already banned |
| DELETE | `/groups/:id/bans/:email` | Lift a group-level ban. | 200 · 403 not an admin · 404 |
| POST | `/groups/:id/admins` | Promote a member to admin. | 200 · 403 not an admin · 404 group, or the user isn't a member · 409 already an admin |
| DELETE | `/groups/:id/admins/:email` | Demote an admin, or step down yourself. | 200 · 403 not an admin · 404 group, or the user isn't an admin · 409 the last admin |
| GET | `/channels` | All rooms, or one group's with `?groupId=`. A malformed id returns `[]`. | 200 |
| POST | `/channels` | A group admin creates a room directly. | 201 · 400 missing field · 403 not an admin (members propose instead) · 404 group · 409 name already used in this group |
| PATCH | `/channels/:id` | A group admin renames a room. | 200 · 400 empty name · 403 · 404 · 409 name clash |
| DELETE | `/channels/:id` | A group admin deletes a room, its messages and their images. | 200 · 403 · 404 |
| GET | `/requests` | Filter by `status`, `type`, `groupId`, `requestedBy`, and `scope=super` or `scope=group`. Newest first. | 200 |
| POST | `/requests` | Raise a `group-create`, `group-delete`, `channel-create` or `user-ban` request, each validated for its type. | 201 · 400 missing type or name, unknown type, ban report with no reason, reporting yourself · 403 super admin raising, not an admin or member of the group, target is the super admin · 404 user, group or target · 409 duplicate pending request, name taken, target is a group's only admin |
| POST | `/requests/:id/approve` | Carry the request out: create the group, delete the group, create the room, or permanently ban the user. | 200 · 403 your own request, or not the right authority for this type · 404 request, actor or group · 409 already actioned, requester no longer exists, name or room taken since, target became a group's only admin |
| POST | `/requests/:id/reject` | Reject with a required reason, which the requester sees on their profile. | 200 · 400 no reason · 403 your own request, or not the right authority · 404 · 409 already actioned |
| GET | `/bans` | Every permanently banned account. | 200 |
| GET | `/audit` | The audit log, newest first, optionally `?type=`. | 200 |
| GET | `/audit/types` | The distinct types in the log, sorted, for the filter dropdown. | 200 |
| POST | `/uploads` | Upload a chat image (multipart: `email`, `channelId`, then `image`). Members only. | 201 `{ imageUrl }` · 400 wrong type or unreadable upload · 403 not a member (the file is deleted) · 413 over 5 MB |
| GET | `/uploads/:file` | **Not a route handler**: `express.static` serving uploaded images with `X-Content-Type-Options: nosniff`. | 200 · 404 |
| — | *any route* | The Express 5 error handler, for a failure no route handled (e.g. Mongo down). | 500 `{ error }` |

### Socket.io events

<!-- 7 events, in server.js registerSocketHandlers(). Cover the direction, the
     payload and the ack shape.

     The paragraph underneath is the important one: sendMessage carries no identity.
     The sender is read from the socket's validated join, not the payload, so a
     client cannot spoof another user. That is the direct answer to the actorEmail
     weakness in §1. Also explain socket.to() excluding the sender vs io.to()
     including it, and why each is used where it is. -->

| Direction | Event | Payload / ack |
|---|---|---|
| client → server | `joinRoom` | `{ channelId, email }`. Ack: `{ history, present }` (the last 50 messages oldest first, plus who is in the room), or `{ error }` for a bad id, an unknown room, or a non-member. Leaves any previous room first. |
| client → server | `sendMessage` | `{ body, imageUrl? }`, with no sender. Ack: `{ ok: true }`, or `{ error }` if not joined, empty, the image wasn't issued by `/uploads`, or the sender is no longer a member. |
| client → server | `leaveRoom` | No payload. Removes this socket from the room and presence. |
| client → server | `disconnect` | Built in (closed tab, lost network). Handled the same as `leaveRoom`. |
| server → client | `newMessage` | The saved message `{ _id, channelId, sender, body, imageUrl, at }`, sent to **everyone** in the room including the sender (`io.to`). |
| server → client | `presence` | `string[]` of the emails in the room, sent to everyone in it after every join and leave. |
| server → client | `userJoined` | `{ email }`, sent to everyone **except** the joiner (`socket.to`). |
| server → client | `userLeft` | `{ email }`, sent to everyone still in the room. |

### Data structures

<!-- 7 collections: users, groups, channels, messages, requests, audit, banned.
     Key fields only, not every field.

     Then the paragraph worth the most marks in this whole document: why group
     admin status lives on the group as adminEmails[] and not as a role on the
     user - because one person can admin several groups while being an ordinary
     member of others. Have this one ready to say out loud. -->

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

<!-- 6, created in seed.js. For each one say which query it serves - an index with
     no named query is just a claim. The groups.name one needs the collation
     explained (locale en, strength 2 = case-insensitive uniqueness enforced by the
     database, not just by a route check). -->

| Collection | Index | Purpose |
|---|---|---|
| `users` | `{ email: 1 }` unique | The lookup in `/login`, `/register` and every route that checks an actor. Also guarantees one account per email even if two registrations race. |
| `banned` | `{ email: 1 }` unique | The permanent-ban check in `/register`. |
| `groups` | `{ name: 1 }` unique, collation `{ locale: 'en', strength: 2 }` | Case-insensitive uniqueness enforced by the database itself. `nameTaken()` gives the friendly 409; the index is the guarantee. |
| `requests` | `{ status: 1, createdAt: -1 }` | Both request queues: `GET /requests?status=pending`, newest first. |
| `audit` | `{ type: 1, at: -1 }` | `GET /audit?type=`, newest first. |
| `messages` | `{ channelId: 1, at: 1 }` | Room history in `joinRoom` (`find({ channelId }).sort({ at: -1 }).limit(50)`). Created in `server.js` `start()`, not `seed.js`. |

### Error handling

<!-- Short. One Express 5 error middleware at the bottom of server.js instead of 28
     try/catch blocks, because Express 5 forwards a rejected promise from an async
     handler and Express 4 did not. Four arguments is what marks it as an error
     handler. Good answer to "where is your error handling?" -->


## 3. Angular Components, Services and Models

<!-- Open with the two architectural facts: standalone components, no NgModules;
     and zoneless change detection, which is why anything set inside an async
     callback is a signal() while [(ngModel)] values stay plain properties (a DOM
     event already schedules a redraw). This caused you real pain - worth a sentence
     saying so. -->

### Components

<!-- 9. client/src/app/ - one directory each, plus App at the root. -->

| Component | Purpose |
|---|---|
| `App` (`app-root`) | The root. Its template is only `<router-outlet>`. |
| `Navbar` (`app-navbar`) | Shared header imported by every signed-in page. It shows the Dashboard link, a Group Admin link on a group you admin, a Super Admin link for the super admin, and an account menu (avatar or initial) with your name, email, Profile and Logout. The menu closes on an outside click, Escape or navigation. |
| `Login` (`app-login`) | Email and password form. Stores the session in localStorage and goes to the dashboard. Ignores a double submit. |
| `Register` (`app-register`) | Signup with optional display name and date of birth. Tells the first account it became the super admin. |
| `UserDashboard` (`app-user-dashboard`) | My Groups (with Leave), Discover with live search and Join, the group-request form, and your pending requests. The super admin sees All Groups instead. |
| `Profile` (`app-profile`) | View and edit your own profile (everything except email), upload or remove a profile picture, the groups you admin, and your pending and rejected requests with reasons. |
| `GroupView` (`app-group-view`) | A group's banner in its theme colour and its rooms. Members open rooms and propose new ones; non-members see a Join button and locked rooms. |
| `ChatRoom` (`app-chat-room`) | The live chat. Room list, messages with avatars, names, admin tags and dates, text and image composer, the presence list (a strip on mobile), and join/leave notices. Holds no chat state of its own. |
| `AdminDashboard` (`app-admin-dashboard`) | One group's admin page: edit settings, request deletion, add, rename and delete rooms, promote, demote, remove, group-ban or report members, lift bans, and approve or reject room proposals. Irreversible actions ask for confirmation. |
| `SuperAdminDashboard` (`app-super-admin-dashboard`) | Four panels: the pending request queue (approve, or reject with a reason; bans and group deletions ask for confirmation), every account, permanently banned accounts, and the audit log with a type filter. |
| `Autofocus` (directive, `[appAutofocus]`) | Focuses the Cancel button when a confirm box appears, so keyboard focus isn't lost and Enter backs out. |

### Services

<!-- 4: Auth, GroupService, RequestService, ChatService. For ChatService say that it
     owns the one socket connection for the whole app, and that ChatRoom holds no
     chat state of its own - it binds the service's signals straight into the
     template rather than copying them. -->

| Service | Owns |
|---|---|
| `Auth` (`auth.ts`) | Who is signed in: the localStorage session, exposed as the `session` signal so the navbar redraws when it changes. Also register, login, and the users endpoints: fetch, update profile, upload or remove a profile picture. |
| `GroupService` (`group.ts`) | Groups and channels: list, edit, join, leave or remove, ban and unban, promote and demote, the member list for chat, and room create, rename and delete. |
| `RequestService` (`request.ts`) | The request queue (raise, approve, reject, with filters and `scope`), the audit log and its types, and the permanent ban list. |
| `ChatService` (`chat.ts`) | The single socket.io connection for the whole app, and the live chat state as signals: `messages`, `present`, `notice`, `error`. Join, send, leave, rejoin after a reconnect, and the chat image upload. |
| `theme.ts` *(functions, not a service)* | `contrastRatio()` and `readableInk()`: the WCAG contrast maths that picks dark or light text for any group theme. |

### Models

<!-- Grouped by the file they live in: auth.ts, group.ts, request.ts, chat.ts. -->

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
| `JoinResult` | `chat.ts` | Internal. The `joinRoom` ack: `history` and `present`, or `error`. |

### Route guards

<!-- 3, all in guards.ts. Note that groupAdminGuard is async and returns an
     Observable because it has to fetch the group first. -->

| Guard | Rule |
|---|---|
| `authGuard` | Someone is signed in (an email in localStorage); otherwise redirect to `/login`. Synchronous boolean. |
| `superAdminGuard` | The stored role is `'super'`; otherwise redirect to `/user-dashboard`. Synchronous boolean. |
| `groupAdminGuard` | Your email is in the `adminEmails` of the group in `:groupId`; otherwise redirect to `/user-dashboard`. **Returns an Observable**, because group admin isn't stored on the user and the group has to be fetched first. |

### Routes

<!-- From app.routes.ts. Say which are behind authGuard and what the wildcard does. -->

| Path | Component | Guard |
|---|---|---|
| `''` | — | Redirects to `/login` |
| `login` | `Login` | none |
| `register` | `Register` | none |
| `user-dashboard` | `UserDashboard` | `authGuard` |
| `profile` | `Profile` | `authGuard` |
| `groups/:id` | `GroupView` | `authGuard` |
| `groups/:groupId/channels/:channelId` | `ChatRoom` | `authGuard` (the server checks membership when joining) |
| `admin-dashboard/:groupId` | `AdminDashboard` | `authGuard`, then `groupAdminGuard` |
| `super-admin-dashboard` | `SuperAdminDashboard` | `authGuard`, then `superAdminGuard` |
| `**` | — | Any unknown URL redirects to `/login`. It's last because the first matching route wins. |


## 4. Design Documents

<!-- Reuse Phase 1 §7 and update it. The wireframes are already in design/ -
     8 files, 6 desktop screens + 2 mobile. Cover:
       - desktop-first with mobile reductions
       - the same components reused at both sizes rather than separate mobile screens
       - 44px minimum touch targets
       - the colour and type tokens

     Then a subsection on what changed in Phase 2: the chat composer, the presence
     list, the request queues, the audit log page.

     ACCESSIBILITY IS EXPLICITLY GRADED IN PHASE 2 AND IS NOT DONE YET.
     Do the work before you write this section, then describe what you actually did:
       - the theme contrast fix (deriving banner text colour from the theme's
         luminance instead of hardcoding it) - this is the strongest thing you can
         put in this section, because it is a consequence of the client's own
         "theme extends into chat rooms" requirement
       - labels on the 7 unlabelled form controls
       - the global :focus-visible outline in styles.css
       - role="status" / role="alert" on messages outside the chat room -->

### Wireframes

All in [`design/`](design/). The last column is honest on purpose: update it if you redraw any of them before submitting.

| Screen | Desktop | Mobile | Changed since the wireframe |
|---|---|---|---|
| Login | [`Login_wireframe.png`](design/Login_wireframe.png) | [`Mobile_login.PNG`](design/Mobile_login.PNG) | Register link; error and success messages |
| User dashboard | [`User_Dashboard_Wireframe.png`](design/User_Dashboard_Wireframe.png) | [`Mobile_dashboard.PNG`](design/Mobile_dashboard.PNG) | "Request Group" form instead of direct create; Leave buttons; pending requests; account menu replaces the bottom-left user card |
| Group / channel view | [`Group_Channel_view_wireframe.png`](design/Group_Channel_view_wireframe.png) | — | Propose-a-room form, proposed rooms list, Join bar and locked rooms for non-members |
| Chat room | [`In_chatroom_wireframe.png`](design/In_chatroom_wireframe.png) | — | Live presence list (a strip on mobile), join/leave notice, avatars, image attach and preview, dates on older messages, mobile Back link |
| Group admin | [`admin_view_wireframe.png`](design/admin_view_wireframe.png) | — | Editable settings, room management, promote/demote/remove/ban/report, banned list, room proposals instead of join requests, confirm boxes |
| Super admin | [`super_admin_wireframes.png`](design/super_admin_wireframes.png) | — | No Un-ban button and no direct Ban (the spec forbids both); approve/reject with reasons; audit type filter; confirm boxes |
| Profile | — | — | Not wireframed: edit form, profile picture, groups administered, pending and rejected requests |

### Responsive methodology

### Accessibility


## 5. Testing

<!-- Tools: Vitest 4 via @angular/build:unit-test, jsdom, Angular TestBed with
     provideHttpClientTesting.

     Methodology paragraph: the HTTP backend is swapped for a test backend that
     queues requests, so each test asserts what the component *asked for* and hands
     back a fixed reply. Shared setup lives in testing.ts - testProviders(),
     httpMock(), signIn/signOut and the makeGroup/makeChannel/makeRequest/makeUser
     builders - rather than being repeated in 14 files. flushByUrl answers a
     component's several startup requests by matching on URL, because their order is
     not something a test should depend on.

     Worth one line: no application code was changed to suit the tests. -->

### Automated test suite

<!-- 14 spec files. RUN `npm test` IN client/ AND USE THE REAL NUMBER - a static
     count says 99 but nobody has confirmed they all pass since sockets and images
     landed. Put the pass/fail line and the duration under the table. -->

**Server — integration tests** (`test/`, run with `npm test` from the repo root, needs `mongod`)

| Spec file | Tests | Covers |
|---|---|---|
| `api.test.js` — auth and users | 16 | health check; first account becomes super admin; bcrypt hash stored, never the password; email normalised; 400 on missing fields, bad email, short password; 403 on a banned email; identical 401 for wrong password and unknown email; password never returned; profile edit own-only (403), role not editable, changed password re-hashed |
| `api.test.js` — profile pictures | 5 | your own picture stored with a random file name, returned on the account and served; replacing it deletes the old file; someone else's picture 403 with no file left on disk; SVG refused (400); remove clears it and deletes the file, own account only |
| `api.test.js` — groups | 26 | list; edit admin-only (403); malformed id is 404, not 500; a name another group has (409); raising the age limit boots under-age members but never an admin; delete super-admin-only and cascades rooms and messages; member list returns only email, name and picture; join, already-in and super admin (409), joining for someone else (403), too young or no date of birth (403); leave and remove; last admin can't be removed, banned or demoted (409); group ban blocks rejoin, lifting it allows it; promote and demote |
| `api.test.js` — channels | 9 | list all / by group, malformed group id gives `[]`; admin creates, member gets 403 (must propose); duplicate name in a group (409); rename rules (403, 400, 409); delete admin-only and removes its messages |
| `api.test.js` — requests | 21 | `scope` splits the super admin and group admin queues; `requestedBy` filter; super admin can't raise requests (403); duplicate pending name (409); member-only proposals, admin-only deletion requests; ban report needs a reason (400) and won't target a group's only admin (409); approve carries out all four types; nobody approves their own (403); can't action twice (409); name re-checked at approval time (409); approved ban deletes the account and blocks re-registering; a ban closes the banned user's pending requests; a request from a deleted account can't be approved (409); deleting a group closes its other pending requests; reject needs a reason (400) and has the same authority check |
| `api.test.js` — bans and audit | 3 | banned list; audit newest first and filterable by type; distinct sorted types, refused actions not logged |
| `api.test.js` — uploads | 5 | member upload gets a random file name and is served with `nosniff`; non-member 403 and the file is removed from disk; SVG refused (400); over 5 MB refused (413); unknown file 404 |
| `sockets.test.js` | 15 | members only can join; bad or unknown room refused; history and presence in the join ack; `userJoined` to others but not the joiner; history replayed oldest first; must join before sending; empty message refused; `newMessage` reaches the sender too and is stored; sender taken from the join, not the payload; a sender removed from the group after joining is refused; uploaded image sends, an image url the server never issued is refused; leave and disconnect both send `userLeft` and update presence, no ghost entries |

**Result: 2 files, 100 tests, 100 passed, about 2s.**

**Client — unit tests** (`client/`, Vitest via `ng test`)

| Spec file | Tests | Covers |
|---|---|---|
| `auth.spec.ts` | 12 | register and login payloads, url-encoded email, profile update never sends email or role, session round trip through `localStorage`, super admin detection, logout; profile picture upload sends `actorEmail` before the file; remove sends `actorEmail`; the `session` signal updates on save and logout |
| `group.spec.ts` | 6 | `GroupService` call shapes: actor sent with edits, url-encoded member removal, promote POST vs demote DELETE, reason sent with a ban |
| `request.spec.ts` | 5 | empty filters dropped rather than sent, request payload, reject sends the reason, audit type only sent when chosen |
| `theme.spec.ts` | 7 | WCAG contrast end points (21:1 and 1:1), symmetric, short hex form, dark vs light ink choice, every seeded theme passes AA 4.5:1, safe fallback on a bad value |
| `guards.spec.ts` | 6 | `authGuard`, `superAdminGuard` and `groupAdminGuard`, each allowing and redirecting |
| `app.spec.ts` | 2 | root component creates and renders the router outlet |
| `login.spec.ts` | 4 | stores the user (including the picture) on success, shows the server's error, ignores a double submit |
| `register.spec.ts` | 5 | ordinary signup clears the form, first-account super admin message, server errors shown |
| `navbar.spec.ts` | 10 | Super Admin link only for the super admin; Group Admin link only on a group this user admins; account menu shows the initial, opens with name, email, Profile and Logout; shows the uploaded picture; closes on Escape and an outside click; logout clears the session and goes to login |
| `user-dashboard.spec.ts` | 7 | My Groups / Discover split, super admin view, search filter, group request instead of create, age-limit rejection and last-admin 409 surfaced |
| `group-view.spec.ts` | 11 | admin / member / non-member recognised, propose a room instead of creating it, 409 surfaced, pending proposals listed; non-member gets a Join button and locked rooms; joining sends `actorEmail` and unlocks the rooms; a refused join shows the server's reason; no Join button for the super admin |
| `chat-room.spec.ts` | 20 | joins the room in the url, admin indicator, theme colour and fallback, socket messages and presence rendered, send trims and clears, empty send blocked, image upload rules (type and 5 MB checked before uploading), image with and without text, members-only composer, leaves on destroy; sender's picture and display name shown, with initial and email fallbacks; time only for today, date for older messages |
| `profile.spec.ts` | 10 | loads from the server not `localStorage`, age from date of birth, pending vs rejected requests, groups administered, blank password not sent, server errors shown; picture uploads and refreshes the session; bad type or over 5 MB refused before uploading; picture removed |
| `super-admin-dashboard.spec.ts` | 9 | only super admin request types fetched, audit refetched on filter change, approve, 400 on a rejection with no reason, request type labels; approving a ban asks first and says what it will do; a new group approves straight away |
| `admin-dashboard.spec.ts` | 14 | last admin flagged, actor sent with settings, booted members reported, deletion and ban go through requests, direct group ban, own-proposal 403 surfaced, rejection reason sent; deleting a room asks first and focuses Cancel; cancelling sends nothing; remove asks first, one box open per member |

**Result: 15 files, 128 tests, 128 passed.**

**Total: 228 automated tests, all passing** (re-run 2026-09-30).

### Manual and integration testing

<!-- This is real work that otherwise goes uncredited, so write it up:
       - the throwaway Node harness that drove 90 checks against a live server and
         live database, covering every route and every status code (last-admin 409,
         approve-your-own-request 403, reject-without-reason 400, banned-member-
         cannot-rejoin 403, age-raise boots members but not admins, DELETE /groups
         cascading its rooms). Say plainly that it was not committed.
       - two-browser verification of the socket layer: two members of Book Club in
         the same room, checking the presence list, the join/leave notices and live
         messages in both windows.
       - browser verification of all 7 routes against live Mongo data. -->

### Gaps

<!-- Name them rather than letting the marker find them. There are no server-side
     automated tests at all, which means the socket handlers, POST /uploads and the
     password hashing have no automated coverage - all 99 tests are client-side.
     Say what you would do about it. -->


## 6. Git Strategy

<!-- Not in the required list for Phase 2, but git is graded directly and this is
     cheap to write. Facts:
       - branch per feature, feature/* throughout. `git branch -a` is worth showing
         at the demo.
       - Phase 1 submitted at 592a880, tagged phase-1-submission. Everything after
         phase-2-start (092dd60) is Phase 2.
       - the lesson worth admitting: the Mongo migration was written against a stale
         server.js because origin/main had not been pulled first. The merge was
         aborted rather than resolved, the work parked on a branch, and the migration
         redone against the current file. Pull before starting, not after finishing.

     Admitting that one costs nothing and shows you understand the tooling. -->


<!-- ============================================================
     BEFORE SUBMITTING - 5pm Fri 02 Oct 2026
       [ ] delete every comment block in this file
       [ ] run `npm test` in client/ and put the real number in §5
       [ ] do the accessibility work, then write §4
       [ ] make the repo PRIVATE and add the teaching staff as a collaborator
           (currently public, Jack-Crook is the only collaborator)
       [ ] export to a single PDF: name + snumber + repo link + this file
       [ ] submit to Canvas
     ============================================================ -->
