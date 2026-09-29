
# Fabulari: Phase 2

**Name:** Jack Crook
**Student number:** s5389490
**Workshop Time:** Thursday 9am
**Repository:** https://github.com/Jack-Crook/Fabulari_3813

<!-- ============================================================
     HOW TO USE THIS FILE
     Every <!-- comment --> is a prompt for you, not content.
     Delete them all before exporting the PDF.
     Tables are empty on purpose: the columns are right, the rows
     are yours. Where a row count or a source file is noted, that
     is so you know when a table is finished.
     ============================================================ -->


## 1. Specifications and Requirements

<!-- Open with a short paragraph: where the requirements came from (the brief, the
     Week 2 client briefing, the numbered Specification Update docs), and the fact
     that the client is the convenor and the brief is deliberately incomplete.
     Then say in one line what changed since Phase 1: Phase 1 was UI + user
     management on JSON files; Phase 2 is the whole app on MongoDB with real-time
     messaging. -->

### Requirements implemented in Phase 2

<!-- 27 requirements, R1-R27. Reuse the Phase 1 §3 requirement wording where it
     still holds and mark what is new in Phase 2 (sockets, presence, images,
     hashing). "Where it's enforced" should name a route, an event or a file so a
     marker can go and look at it. -->

| # | Requirement | Where it's enforced |
|---|---|---|
|  |  |  |

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

<!-- Lead with the stack line: Express 5.2 on port 3000, server.js at the repo root,
     MongoDB 8.0 via the mongodb driver 7.6, database `fabulari`, socket.io 4.8 on
     the same HTTP server, multer 2.4 for uploads, bcrypt 6.0 cost 10.

     Then a conventions paragraph: errors are always { "error": "..." }, email is
     trimmed and lowercased on every route, ids are ObjectIds serialised as 24-char
     hex, and a malformed id gives 404 rather than 500 (say why - toObjectId). -->

### REST endpoints

<!-- 28 handlers. Verify with:
       grep -nE "^app\.(get|post|put|patch|delete)\(" server.js
     GET /uploads/:file is express.static, not a route of its own - list it at the
     bottom for completeness and say so. -->

| Method | Path | Purpose | Status codes |
|---|---|---|---|
|  |  |  |  |

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
|  |  |  |

### Data structures

<!-- 7 collections: users, groups, channels, messages, requests, audit, banned.
     Key fields only, not every field.

     Then the paragraph worth the most marks in this whole document: why group
     admin status lives on the group as adminEmails[] and not as a role on the
     user - because one person can admin several groups while being an ordinary
     member of others. Have this one ready to say out loud. -->

| Collection | Key fields |
|---|---|
|  |  |

### Indexes

<!-- 6, created in seed.js. For each one say which query it serves - an index with
     no named query is just a claim. The groups.name one needs the collation
     explained (locale en, strength 2 = case-insensitive uniqueness enforced by the
     database, not just by a route check). -->

| Collection | Index | Purpose |
|---|---|---|
|  |  |  |

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
|  |  |

### Services

<!-- 4: Auth, GroupService, RequestService, ChatService. For ChatService say that it
     owns the one socket connection for the whole app, and that ChatRoom holds no
     chat state of its own - it binds the service's signals straight into the
     template rather than copying them. -->

| Service | Owns |
|---|---|
|  |  |

### Models

<!-- Grouped by the file they live in: auth.ts, group.ts, request.ts, chat.ts. -->

| Model | File | Note |
|---|---|---|
|  |  |  |

### Route guards

<!-- 3, all in guards.ts. Note that groupAdminGuard is async and returns an
     Observable because it has to fetch the group first. -->

| Guard | Rule |
|---|---|
|  |  |

### Routes

<!-- From app.routes.ts. Say which are behind authGuard and what the wildcard does. -->

| Path | Component | Guard |
|---|---|---|
|  |  |  |


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
| `api.test.js` — groups | 26 | create (creator is first admin); case-insensitive unique names (409); edit admin-only (403); malformed id is 404, not 500; raising the age limit boots under-age members but never an admin; delete super-admin-only and cascades rooms and messages; join, already-in and super admin (409), too young or no date of birth (403); leave and remove; last admin can't be removed, banned or demoted (409); group ban blocks rejoin, lifting it allows it; promote and demote |
| `api.test.js` — channels | 9 | list all / by group, malformed group id gives `[]`; admin creates, member gets 403 (must propose); duplicate name in a group (409); rename rules (403, 400, 409); delete admin-only and removes its messages |
| `api.test.js` — requests | 18 | `scope` splits the super admin and group admin queues; `requestedBy` filter; super admin can't raise requests (403); duplicate pending name (409); member-only proposals, admin-only deletion requests; ban report needs a reason (400) and won't target a group's only admin (409); approve carries out all four types; nobody approves their own (403); can't action twice (409); name re-checked at approval time (409); approved ban deletes the account and blocks re-registering; reject needs a reason (400) and has the same authority check |
| `api.test.js` — bans and audit | 3 | banned list; audit newest first and filterable by type; distinct sorted types, refused actions not logged |
| `api.test.js` — uploads | 5 | member upload gets a random file name and is served with `nosniff`; non-member 403 and the file is removed from disk; SVG refused (400); over 5 MB refused (413); unknown file 404 |
| `sockets.test.js` | 14 | members only can join; bad or unknown room refused; history and presence in the join ack; `userJoined` to others but not the joiner; history replayed oldest first; must join before sending; empty message refused; `newMessage` reaches the sender too and is stored; sender taken from the join, not the payload; uploaded image sends, an image url the server never issued is refused; leave and disconnect both send `userLeft` and update presence, no ghost entries |

**Result: 2 files, 91 tests, 91 passed, about 2s.** Run 10 times in a row with no failures.

**Client — unit tests** (`client/`, Vitest via `ng test`)

| Spec file | Tests | Covers |
|---|---|---|
| `auth.spec.ts` | 9 | register and login payloads, url-encoded email, profile update never sends email or role, session round trip through `localStorage`, super admin detection, logout |
| `group.spec.ts` | 6 | `GroupService` call shapes: actor sent with edits, url-encoded member removal, promote POST vs demote DELETE, reason sent with a ban |
| `request.spec.ts` | 5 | empty filters dropped rather than sent, request payload, reject sends the reason, audit type only sent when chosen |
| `theme.spec.ts` | 7 | WCAG contrast end points (21:1 and 1:1), symmetric, short hex form, dark vs light ink choice, every seeded theme passes AA 4.5:1, safe fallback on a bad value |
| `guards.spec.ts` | 6 | `authGuard`, `superAdminGuard` and `groupAdminGuard`, each allowing and redirecting |
| `app.spec.ts` | 2 | root component creates and renders the router outlet |
| `login.spec.ts` | 4 | stores the user on success, shows the server's error, ignores a double submit |
| `register.spec.ts` | 5 | ordinary signup clears the form, first-account super admin message, server errors shown |
| `navbar.spec.ts` | 6 | Super Admin link only for the super admin; Group Admin link only on a group this user admins |
| `user-dashboard.spec.ts` | 7 | My Groups / Discover split, super admin view, search filter, group request instead of create, age-limit rejection and last-admin 409 surfaced |
| `group-view.spec.ts` | 7 | admin / member / non-member recognised, propose a room instead of creating it, 409 surfaced, pending proposals listed |
| `chat-room.spec.ts` | 17 | joins the room in the url, admin indicator, theme colour and fallback, socket messages and presence rendered, send trims and clears, empty send blocked, image upload rules (type and 5 MB checked before uploading), image with and without text, members-only composer, leaves on destroy |
| `profile.spec.ts` | 7 | loads from the server not `localStorage`, age from date of birth, pending vs rejected requests, groups administered, blank password not sent, server errors shown |
| `super-admin-dashboard.spec.ts` | 7 | only super admin request types fetched, audit refetched on filter change, approve, 400 on a rejection with no reason, request type labels |
| `admin-dashboard.spec.ts` | 11 | last admin flagged, actor sent with settings, booted members reported, deletion and ban go through requests, direct group ban, own-proposal 403 surfaced, rejection reason sent |

**Result: 15 files, 106 tests, 106 passed.**

**Total: 197 automated tests, all passing** (re-run 2026-09-29).

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
