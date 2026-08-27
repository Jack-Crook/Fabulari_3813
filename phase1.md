
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

There were over 20 branches used for this assignmet, mostly one per feature or component added/fixed, which were merged back into main once it was functional. All of these branches were under feature, except one: group_channel_endpoints.

There was a stale branch bug. I checked out feature/login-auth, which branched weeks earlier, before auth.ts existed. Work was started on it, and ng build failed with: Cannot find module '../auth'. It was not a typo, the file  wasn't on that branch. It was fixed by committing the in-progress work, then merging main


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
| Group admin | A group must always have at least one, but can have several. |
| Promotion | A group admin can promote any member of that group to admin. |
| Demotion | A group admin can demote another admin, only if at least one admin remains. |
| Stepping down | An admin can demote themself, as long as atleast one other remains. |
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
| Disbanding | A group left without a working admin (last admin leaves, nobody to promote) is deleted the same way Via a request to the super admin. |
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
  `user` or `super`. 
- **Email is normalised** to lowercase and trimmed everywhere before being compared or stored,
  since the spec makes email the unique identifier.
- **An age limit of `0`** means the group has no age restriction.
- **Passwords are stored in plain text** in the JSON file for Phase 1. This is not acceptable
  for a real system; hashing belongs with the move to MongoDB in Phase 2.
- **Users have no age field yet**, so the age limit is stored but not enforced in Phase 1.
  Collecting date of birth will be done for phase 2.


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
| `email` | string | Unique identifier for the account. Cannot be changed by the user. |
| `password` | string | Plain text for Phase 1, will be hashed in Phase 2. |
| `role` | string | `user` or `super`. Everyone who registers gets `user`. |

There is deliberately no `group-admin` value. Because a user can be an admin for several
groups while being an ordinary member of others, group-admin status is held on the **group**
rather than the user.

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
| `id` | string | Generated as a prefix plus a timestamp|
| `name` | string | Unique across all groups, compared case-insensitively. |
| `description` | string | Shown on the dashboard and in Discover. |
| `ageLimit` | number | Applies to every channel in the group. `0` means no limit. |
| `theme` | string | Hex colour. Carries through to the group's chat rooms. |
| `adminEmails` | string[] | Must never be empty. The creator is added on creation. |
| `memberEmails` | string[] | Includes the admins. |


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
| `name` | string | Unique within its group |

Channels reference their group with `groupId` rather than groups holding a nested array of
channels. Keeping it flat makes channels easier to query on their own.

## 5. Angular Architecture

The client is a standalone-component Angular app in `client/`, with no NgModules. Every
component declares its own `imports` array, routing is configured in `app.routes.ts`, and the matched component renders into the `<router-outlet>` in `app.html`.

Change detection is driven by signals rather than by patched async APIs. Any value set inside a `subscribe` callback is held in a `signal()` and is read in the template by calling it. Values bound with `[(ngModel)]` stay as plain properties, because a DOM event already schedules a redraw.


### Components

| Component | Selector | Purpose |
|---|---|---|
| `App` | `app-root` | Root shell holding the `<router-outlet>`. |
| `Navbar` | `app-navbar` | Persistent top bar. Uses `routerLink` and `routerLinkActive` to highlight the current page. The Group Admin link is a `computed` that reads the group id out of the URL, so it only appears on a group this user admins. |
| `Login` | `app-login` | Email and password form. Saves the session and redirects on success. |
| `Register` | `app-register` | Self-registration form. |
| `UserDashboard` | `app-user-dashboard` | My Groups and Discover, both filled from one `GET /groups` call. Creates a group and joins one. |
| `Profile` | `app-profile` | The signed-in user's details, read from the stored session. Edit Profile is not wired. |
| `GroupView` | `app-group-view` | Group sidebar, banner in the group's theme colour, and its room list. |
| `ChatRoom` | `app-chat-room` | Room sidebar, conversation, presence list, and the group-admin indicator on a sender. Messages are mock until socket.io. |
| `AdminDashboard` | `app-admin-dashboard` | Group admin view for the group in the URL: settings, rooms, and the member list with a Remove action. Join Requests is mock. |
| `SuperAdminDashboard` | `app-super-admin-dashboard` | Pending requests, all members, permanently banned accounts, and the audit log. All four panels are mock. |


Mock data is used for the features were the endpoints are unimplimented.


### Services

| Service | Purpose | 
|---|---|
| `Auth` (`auth.ts`) | Wraps `HttpClient` calls to `/register` and `/login`, and owns the session. `saveUser()`, `getUser()` and `logout()` against `localStorage`. Injected with `inject()` rather than a constructor parameter. |
| `GroupService` (`group.ts`) | Every groups and channels call: `getGroups`, `getChannels`, `createGroup`, `joinGroup`, `removeMember`, `createChannel`, `deleteChannel`. | 

There are two services because they own differant things. `Auth` owns who is signed in,
`GroupService` owns the group and channel data. Both are `@Service()` classes injected with `inject(HttpClient)`, so the API's base URL is written down in one place per concern instead of being repeated in every component.

### Models

Interfaces rather than classes, since they only describe the shape of JSON crossing the wire.

| Model | File | Fields |
|---|---|---|
| `Group` | `group.ts` | `id`, `name`, `description`, `ageLimit`, `theme`, `adminEmails[]`, `memberEmails[]` |
| `Channel` | `group.ts` | `id`, `groupId`, `name` |
| `LoginResponse` | `auth.ts` | `message`, `email`, `role` |
| `StoredUser` | `auth.ts` | `email`, `role` |




### Routes

| Path | Component | Notes |
|---|---|---|
| `''` | — | Redirects to `login`. |
| `login` | `Login` | |
| `register` | `Register` | |
| `user-dashboard` | `UserDashboard` | Where every role lands after logging in. |
| `profile` | `Profile` | |
| `groups/:id` | `GroupView` | `:id` is the group being opened. |
| `groups/:groupId/channels/:channelId` | `ChatRoom` | One room inside that group. |
| `admin-dashboard/:groupId` | `AdminDashboard` | Parameterised because a user can admin any number of groups, so the page has to know which one. |
| `super-admin-dashboard` | `SuperAdminDashboard` | |
| `**` | — | Redirects to `login`. Must stay last, first match wins. |

The routes above are everything implimented for Phase 1. For phase 2, group and channel editing,
admin promotion and demotion, the request and approval flow, the audit log, profile editing,
system-wide bans, and image upload will all be added.





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

Validation is enforced by these routes: a group can never lose its last admin, an unregistered
email cannot be added to a group, a channel cannot exist without a real group, group names are
unique system-wide, channel names are unique within their group, super admins can neither create or be added to a group.

## 7. Design Docs

Wireframes were drawn in Freeform on iPad, exported as images, and
committed to the `design/` folder. They cover login, user dashboard, group and channel view, chat room,
 group admin panel, the super admin panel as well as the mobile views for the login page and dashboard.



### Responsive methodology


The layout was designed fro desktop first and then reduced for mobile. The same components
are reused at both sizes rather than building separate mobile screens:

- **Login and register** are a fixed 400px card centred on the page at desktop width. On mobile
  the card goes full width with 24px padding and the shadow and border are dropped.
- **The user dashboard** is My Groups and Discover side by side using flexbox at desktop width. For mobile they stack one on top of the other
- **The navbar** keeps the logo on the left and the links on the right at desktop width.
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
