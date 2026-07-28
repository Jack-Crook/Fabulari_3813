# Phase 1 — Full Stack Chat Application

<!-- REQUIRED HEADER — fill these in before submitting -->
**Student number:** sXXXXXXX
**Name:** Jack Crook
**Workshop time:** <day/time>

---

## 1. Project Overview

<!-- Brief description of the project. 1–3 short paragraphs. -->
A full-stack real-time chat application built on the **MEAN stack** (MongoDB, Express,
Angular 20+, Node.js) with **socket.io** for real-time messaging. Users exchange text and
image messages in real time, organised into **groups** and **channels**. Users have one of
several permission levels, with elevated (admin) users able to manage user requests and
assign users to groups and channels.

**Permission levels (confirm against client briefing):**
- **Super Admin** — full control of all groups, channels, and users; can promote/demote.
- **Group Admin** — manages the groups they own: channels, membership, bans.
- **User** — joins groups/channels, sends messages, requests to join groups.

---

## 2. Git Strategy

<!-- Outline branching model, commit conventions, how you used Git during development. -->
- **Repository:** <GitHub URL> — teaching staff added as collaborator.
- **Branching model:** `main` (stable/demo) + short-lived feature branches
  (`feature/…`, `fix/…`) merged via PR / fast-forward.
- **Commit style:** small, focused commits with imperative messages
  (e.g. `add channel model`, `wire login endpoint`).
- **Cadence:** commit at each working milestone so history documents progress.
- *(Note: pushes after the due date are ignored by markers.)*

---

## 3. Functional Requirements & Assumptions

<!-- Table layout preferred. Mark each as Requirement or Assumption. -->

| ID | Type | Requirement / Assumption |
|----|------|--------------------------|
| FR-1 | Req | Users authenticate with username + password (basic auth for Phase 1). |
| FR-2 | Req | Three permission levels: Super Admin, Group Admin, User. |
| FR-3 | Req | Users can be created, assigned to groups/channels, and stored persistently. |
| FR-4 | Req | Groups contain one or more channels; channels contain messages. |
| FR-5 | Req | Users send text messages in real time within a channel (socket.io — Phase 2). |
| FR-6 | Req | Users can send images as messages (Phase 2). |
| FR-7 | Req | Super Admin can promote a user to Group Admin / Super Admin. |
| FR-8 | Req | Group Admin can create/remove channels and add/ban users in their groups. |
| FR-9 | Req | Users can request to join a group; admins approve. |
| FR-10 | Req | A user can delete their own account; admins can delete users. |
| A-1 | Assume | A default Super Admin account (`super` / `123`) seeds on first run. |
| A-2 | Assume | Phase 1 data persists to a **JSON file**; no DB until Phase 2. |
| A-3 | Assume | <add assumptions from Week 2 briefing / announcements here> |

---

## 4. Data Structures

<!-- Describe how data is stored/represented. Show the JSON shapes used in Phase 1. -->

**User**
```json
{
  "id": "u1",
  "username": "jack",
  "email": "jack@example.com",
  "password": "hashed_or_plain_for_phase1",
  "roles": ["User"],
  "groups": ["g1"]
}
```

**Group**
```json
{
  "id": "g1",
  "name": "COMP Study Group",
  "adminIds": ["u1"],
  "memberIds": ["u1", "u2"],
  "channelIds": ["c1"]
}
```

**Channel**
```json
{
  "id": "c1",
  "name": "general",
  "groupId": "g1",
  "memberIds": ["u1", "u2"]
}
```

**Message** *(mock in Phase 1, real via sockets in Phase 2)*
```json
{
  "id": "m1",
  "channelId": "c1",
  "userId": "u1",
  "type": "text",
  "content": "hello",
  "timestamp": "2026-08-01T10:00:00Z"
}
```

Storage in Phase 1: a server-side `data.json` (or `users.json` / `groups.json` /
`channels.json`) read/written by the Node/Express backend.

---

## 5. Angular Architecture

<!-- Components, services, models, routes. Doesn't need full implementation, but define it. -->

**Components**
| Component | Responsibility |
|-----------|----------------|
| `LoginComponent` | Username/password login form. |
| `DashboardComponent` | Landing after login; shows groups/channels for the user's role. |
| `GroupListComponent` | List + create/join groups. |
| `ChannelListComponent` | Channels within a selected group. |
| `ChatComponent` | Message view for a channel (mock data Phase 1, sockets Phase 2). |
| `AdminUsersComponent` | Super Admin: manage users, roles, requests. |
| `NavComponent` | Top/side nav, current user, logout. |

**Services**
| Service | Responsibility |
|---------|----------------|
| `AuthService` | Login/logout, current user + role, route guarding. |
| `UserService` | CRUD users via backend endpoints. |
| `GroupService` | CRUD groups, membership. |
| `ChannelService` | CRUD channels. |
| `SocketService` | (Phase 2) socket.io connection + message events. |

**Models:** `User`, `Group`, `Channel`, `Message` (mirror the JSON shapes above).

**Routes**
| Path | Component | Guard |
|------|-----------|-------|
| `/login` | LoginComponent | — |
| `/dashboard` | DashboardComponent | auth |
| `/groups/:id` | ChannelListComponent | auth |
| `/groups/:id/channels/:cid` | ChatComponent | auth + member |
| `/admin/users` | AdminUsersComponent | auth + SuperAdmin |

---

## 6. Server Endpoints (proposed)

<!-- Not all need to be implemented in Phase 1; define them. Phase 1 focus: user mgmt. -->

| Method | Endpoint | Purpose | Phase 1? |
|--------|----------|---------|:--------:|
| POST | `/api/auth/login` | Authenticate username/password | ✅ |
| POST | `/api/users` | Create user | ✅ |
| GET | `/api/users` | List users | ✅ |
| GET | `/api/users/:id` | Get a user | ✅ |
| PUT | `/api/users/:id` | Update user / roles | ✅ |
| DELETE | `/api/users/:id` | Delete user | ✅ |
| POST | `/api/groups` | Create group | ✅ |
| GET | `/api/groups` | List groups | ✅ |
| PUT | `/api/groups/:id` | Update group / membership | ✅ |
| DELETE | `/api/groups/:id` | Delete group | ✅ |
| POST | `/api/groups/:id/channels` | Create channel | ✅ |
| DELETE | `/api/channels/:id` | Delete channel | ✅ |
| GET | `/api/channels/:id/messages` | Message history | Phase 2 |
| POST | `/api/upload` | Image upload | Phase 2 |

*(socket.io events in Phase 2: `join-channel`, `message`, `leave-channel`, etc.)*

---

## 7. Design Documents & Storyboards

<!-- Responsive design methodology. Embed/link wireframes for each permission level. -->
- **Responsive methodology:** mobile-first layout, breakpoints for phone / tablet / desktop;
  nav collapses to a drawer on small screens.
- **Storyboards / wireframes** (link images or embed here):
  - Login screen
  - User dashboard (groups → channels → chat)
  - Group Admin view (manage channels/members)
  - Super Admin view (manage all users/roles/requests)
- **User flow:** Login → Dashboard → select Group → select Channel → Chat.

> _Add wireframe images to `./design/` and reference them here._
