
# Fabulari — Phase 1

**Name:** Jack Crook
**Student number:** s5389490
**Workshop Time:** Thursday 9am
**Repository:** https://github.com/Jack-Crook/Fabulari_3813

## 1. Project Description

Fabulari is a full stack chat app using the MEAN stack (MongoDB, Express, Angular, Node.js).

A user can register an account, join groups , and talk to each other in differant chat rooms
inside these groups. Messages are text and images, which will be sent real time with socket.io. Groups are
run by group admins who manage their members and rooms, and a whole group has a single
super admin who handles requests that group admins can't do themselves, such as creating or
deleting a group and permanently banning a user.

Phase 1 of this assignment covers the front end ui and a limited back end. The back end include user management and groups and channels stored in JSON files on the server. There is no database and no real time messaging yet. both are Phase 2.

## 2. Git Strategy

Every time a new feature is added, a branch is created under `feature/(feature name)`. The
reason I branched for every major feature was to isolate my work from the main codebase so I
could make major changes without breaking the working version of the project.

Each branch was merged back into `main` once the feature works, so `main` always holds the working version and so that the history shows the order things were actually built in.

## 3. Functional Requirements

Requirements come from the assignment spec, the client briefing, and the numbered
Specification Update documents.
### Authentication and users

| Feature | Requirement |
|---|---|
| Registration | Users self-register. There is no admin-created account path. |
| Login | Email and password. Email is the unique identifier for an account. |
| Profile editing | A user can edit every profile field except email. |
| Profile visibility | Profiles are private. No public or limited view for other users. |

### Roles and permissions

| Feature | Requirement |
|---|---|
| Super admin | Exactly one exists only. |
| Group admin | A group must always have at least one. A group can have several. |
| Promotion | A group admin can promote any existing member of that group to admin. |
| Demotion | A group admin can demote another admin, only if at least one admin remains. |
| Stepping down | An admin can demote themself under the same rule — another admin must remain. |
| Admin scope | There is no limit on how many groups one user can be a group admin of. |
| Contacting super admin | Regular users cannot contact the super admin directly. |
| Super admin limits | Only actions requests. Cannot create groups directly, cannot approve a request they raised, cannot ban a user without a prior report. |
| Chat indicator | Chat shows an indicator when the sender is that group's admin. |

### Groups

| Feature | Requirement |
|---|---|
| Creation | A user requests a group from the super admin, supplying title, description, age limit and colour theme up front. On approval the requesting user becomes the group's first admin. |
| Editing | A group admin can change name, description, theme colour and age limit at any time, with no request needed. |
| Deletion | The group admin requests deletion from the super admin. A group admin cannot delete their own group directly. |
| Disbanding | A group left without a working admin (last admin leaves, nobody to promote) is deleted the same way — via a request to the super admin. |
| Age limit | Set at group level and applies to every channel in that group. Channels do not get their own limit. |
| Raising the age limit | Existing members below the new threshold are automatically removed. |
| Joining | Users can see every group regardless of age, but are auto-rejected if they try to join one they don't meet the age requirement for. |
| Customisation | No group profile picture. The theme colour is the customisation, and it extends into that group's chat rooms. |

### Channels / rooms

| Feature | Requirement |
|---|---|
| Creation | Regular users propose a channel; the group admin approves or rejects it. |
| Editing | A group admin can rename or edit a room they created. |
| Count | No minimum. A group can have zero rooms, or unlimited. |
| Presence | Users get a live list of who else is currently in a room. |
| Join/leave notice | On top of that list, users are notified when someone joins or leaves while they are in the room. |

### Requests, bans and auditing

| Feature | Requirement |
|---|---|
| Rejections | A rejected request must include a reason. |
| Cancelling | A pending request cannot be cancelled once submitted. |
| Request visibility | A user can see their own pending requests and their own past rejected requests. |
| Audit log | The super admin has an audit log page, filterable by type, in date order, covering all logs system-wide. |
| Group-level ban | A group admin removes a user's access to that one group. The account itself still exists. |
| System-wide ban | Only the super admin, and only from a group admin's request. Permanent — the email can never be reused, so unbanning does not exist. |
| Banning an admin | If the user being removed is a group admin, a replacement admin must be assigned first. |
| Member lists | A group admin sees the full member list and banned-user list for their own group only. The super admin sees all permanently banned accounts system-wide. |

### Assumptions


- **Group admin is a relationship, not a role on the user.** A user's `role` field is only
  `user` or `super`. Whether someone is a group admin is derived from whether their email
  appears in that group's `adminEmails`. This is because the spec allows a user to admin any
  number of groups while remaining an ordinary member of others, which a single role string on
  the user cannot express.
- **Email is normalised** to lowercase and trimmed everywhere before being compared or stored,
  since the spec makes email the unique identifier.
- **An age limit of `0`** means the group has no age restriction.
- **Users have no age field yet**, so the age limit is stored but not enforced in Phase 1.
  Collecting date of birth at registration is Phase 2 work.
- **Passwords are stored in plain text** in the JSON file for Phase 1. This is not acceptable
  for a real system; hashing belongs with the move to MongoDB in Phase 2.

## 4. Data Structures

Data is stored in JSON files under `data/` on the server with one file per type. 

### User — `data/users.json`

```json
{
  "email": "test@test.com",
  "password": "pw123",
  "role": "super"
}
```

| Field | Type | Notes |
|---|---|---|
| `email` | string | Unique identifier for the account. Trimmed and lowercased. Cannot be changed by the user. |
| `password` | string | Plain text in for Phase 1, hashed in Phase 2. |
| `role` | string | `user` or `super`. Everyone who self-registers gets `user`. |

There is deliberately no `group-admin` value. Because the spec allows a user to admin several
groups while being an ordinary member of others, group-admin status is held on the **group**
rather than the user — see the assumption in §3.

Since exactly one super admin must always exist and no one can create that account, it is set by
hand in `users.json` rather than through `/register`.

### Group — `data/groups.json`

```json
{
  "id": "g1",
  "name": "Book Club",
  "description": "Fantasy readers book club",
  "ageLimit": 0,
  "theme": "#5FA8D3",
  "adminEmails": ["test@test.com"],
  "memberEmails": ["test@test.com", "jack@123"]
}
```

| Field | Type | Notes |
|---|---|---|
| `id` | string | Generated as a prefix plus a timestamp. Replaced by MongoDB's `_id` in Phase 2. |
| `name` | string | Unique across all groups, compared case-insensitively. |
| `description` | string | Shown on the dashboard and in Discover. |
| `ageLimit` | number | Applies to every channel in the group. `0` means no limit. |
| `theme` | string | Hex colour. Carries through to the group's chat rooms. |
| `adminEmails` | string[] | Must never be empty. The creator is added on creation. |
| `memberEmails` | string[] | Includes the admins. |

Members are stored as **emails rather than ids** because the spec makes email the unique
identifier for a user, and users have no separate id field.

### Channel — `data/channels.json`

```json
{
  "id": "c1",
  "groupId": "g1",
  "name": "General"
}
```

| Field | Type | Notes |
|---|---|---|
| `id` | string | Same generation scheme as groups. |
| `groupId` | string | The group this channel belongs to. |
| `name` | string | Unique within its group, but the same name may repeat across different groups — this is why every group can have its own "General". |

Channels reference their group with `groupId` rather than groups holding a nested array of
channels. Keeping it flat makes channels easier to query on their own and matches how it will be
modelled as a separate collection in Phase 2.

### Planned structures — Phase 2

Defined here but not implemented in Phase 1:

| Structure | Fields | Purpose |
|---|---|---|
| `Request` | `id`, `type` (group creation / group deletion / channel creation / ban), `raisedBy`, `groupId`, `payload`, `status` (pending / approved / rejected), `reason`, `createdAt` | Backs the request and approval flows. `reason` is required on rejection. |
| `AuditLogEntry` | `id`, `type`, `actorEmail`, `targetEmail`, `groupId`, `detail`, `createdAt` | The super admin's filterable, date-ordered audit log. |
| `Message` | `id`, `channelId`, `senderEmail`, `body`, `imageUrl`, `sentAt` | Chat messages, text and images, delivered over socket.io. |
| `BannedEmail` | `email`, `bannedAt`, `reason`, `requestId` | System-wide bans are permanent and the email can never be reused, so banned emails outlive the deleted account and are checked at registration. |

## 5. Angular Architecture

The client is a standalone-component Angular app in `client/`, with no NgModules. Routing is
configured in `app.routes.ts` and the matched component renders into the `<router-outlet>` in
`app.html`.

### Components

| Component | Selector | Purpose | Status |
|---|---|---|---|
| `App` | `app-root` | Root shell holding the `<router-outlet>`. | Done |
| `Navbar` | `app-navbar` | Persistent top bar with logo and navigation. Uses `routerLink` and `routerLinkActive` so the current page is highlighted. | Done |
| `Login` | `app-login` | Email and password form, posts to the API and routes onward on success. | Done |
| `Register` | `app-register` | Self-registration form. | Done |
| `UserDashboard` | `app-user-dashboard` | My Groups list plus the Discover panel with search and request buttons. | Layout done, static data |
| `Profile` | `app-profile` | The signed-in user's details. | Layout done, static data |
| `AdminDashboard` | `app-admin-dashboard` | Group admin view — members, banned users, rooms, and incoming channel requests for the groups they run. | 


### Services

| Service | Purpose | Status |
|---|---|---|
| `Auth` | Wraps `HttpClient` calls to `/register` and `/login`. Injected with `inject()` rather than a constructor parameter. | Done |
| `Auth` (session) | Saving the signed-in user to `localStorage`, reading it back, and clearing it on logout. |

### Routes

| Path | Component | Notes |
|---|---|---|
| `''` | — | Redirects to `login`. |
| `login` | `Login` | |
| `register` | `Register` | |
| `user-dashboard` | `UserDashboard` | |
| `profile` | `Profile` | |
| `admin-dashboard` | `AdminDashboard` | 
| `super-admin-dashboard` | `SuperAdminDashboard` | 

Phase 2 adds `groups/:id` and `groups/:id/channels/:channelId`, both behind a route guard.

## 6. Server Endpoints

The server is Express, in `server.js` at the repository root, listening on port 3000. Angular
runs on port 4200, so `cors()` is enabled to allow requests across the two origins.

### Implemented in Phase 1

| Method | Route | Purpose |
|---|---|---|
| GET | `/` | Health check, confirms the API is running. |
| POST | `/register` | Register a new user. Rejects a duplicate email with 409. |
| POST | `/login` | Basic auth check. Returns the user's email and role. |
| GET | `/groups` | List every group. Feeds both My Groups and Discover. |
| POST | `/groups` | Create a group. The creator becomes its first admin and a member. |
| POST | `/groups/:id/members` | Assign an existing user to a group. |
| DELETE | `/groups/:id/members/:email` | Remove a user from a group. This is the group-level removal, not a system-wide ban. |
| GET | `/channels` | List all channels, or one group's with `?groupId=`. |
| POST | `/channels` | Create a channel inside an existing group. |
| DELETE | `/channels/:id` | Delete a channel. |

Validation enforced by these routes: a group can never lose its last admin, an unregistered
email cannot be added to a group, a channel cannot exist without a real group, group names are
unique system-wide, and channel names are unique within their group.

### Defined but not implemented


| Method | Route | Purpose |
|---|---|---|
| PUT | `/groups/:id` | Group admin edits name, description, theme or age limit. Raising the age limit removes members below it. |
| POST | `/groups/:id/admins` | Promote an existing member to group admin. |
| DELETE | `/groups/:id/admins/:email` | Demote an admin, refused if they are the last one. |
| PUT | `/channels/:id` | Rename or edit a channel. |
| GET | `/requests` | List requests, filtered by the requester or by the group being administered. |
| POST | `/requests` | Raise a request — group creation, group deletion, channel creation, or a ban report. |
| PUT | `/requests/:id` | Approve or reject. A rejection must carry a reason. |
| GET | `/audit` | Super admin's audit log, filterable by type, in date order. |
| DELETE | `/users/:email` | Super admin permanently bans an account. Requires an approved request, and a replacement group admin if the user admins any group. |
| GET | `/users/:email` | Profile details for the signed-in user. |
| PUT | `/users/:email` | Edit profile. Every field except email. |
| POST | `/upload` | Image upload for chat messages (Phase 2). |

## 7. Design Docs

Wireframes were drawn in Apple Freeform on iPad with an Apple Pencil, exported as images, and
committed to the `design/` folder before any application code was written.

| File | Screen |
|---|---|
| `design/Initial_wireframes.png` | First pass — desktop login and desktop user dashboard together |
| `design/Login_wireframe.png` | Login |
| `design/User_Dashboard_Wireframe.png` | User dashboard — My Groups and Discover |
| `design/Group_Channel_view_wireframe.png` | Group with its channel list |
| `design/In_chatroom_wireframe.png` | Chat room |
| `design/admin_view_wireframe.png` | Group admin panel |



### Responsive methodology

<!-- TODO: rewrite this once the mobile wireframes exist so it describes what you actually drew. -->

The layout is designed desktop-first and then reduced for mobile, since the dashboard's
two-panel layout is the hardest case and everything else is simpler than it. The same components
are reused at both sizes rather than building separate mobile screens:

- **Login and register** are a fixed 400px card centred on the page at desktop width. On mobile
  the card goes full width with 24px padding and the shadow and border are dropped.
- **The user dashboard** is My Groups and Discover side by side using flexbox at desktop width.
  Below the breakpoint the two panels stack vertically, My Groups first.
- **The navbar** keeps the logo on the left and the links on the right at desktop width. On
  mobile the links collapse.
- **Touch targets** are at least 44px high, which is why the buttons and inputs share a minimum
  height in the global stylesheet.

### Colour and type

| Token | Value |
|---|---|
| Background | `#FAFAFA` |
| Surface | `#FFFFFF` |
| Text primary | `#1A1D23` |
| Text secondary | `#6B7280` |
| Border | `#E2E4E9` |
| Primary / action | `#0B68DB` |
| Link / active nav | `#3B5BFF` |

Body text is system-ui. Headings use Fraunces, loaded through `@fontsource-variable/fraunces`,
which is where the logo's character comes from.

Group theme colours are chosen per group and are stored on the group record, so they are data
rather than part of the palette above.
