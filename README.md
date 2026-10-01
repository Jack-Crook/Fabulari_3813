# Fabulari

3813ICT Full Stack Development assignment: a real-time chat app on the MEAN stack (MongoDB, Express,
Angular, Node) with socket.io. Users join groups and chat in their rooms with text and images, and
group admins and a super admin manage everything through a request and approval flow.

The design and API documentation is in [`Phase2.md`](Phase2.md).

## Requirements

- Node.js 22 or newer, with npm
- MongoDB on `localhost:27017`, for example:
  - macOS (Homebrew): `brew services start mongodb-community`
  - Docker or Podman: `podman run -d --name fabulari-mongo -p 27017:27017 docker.io/library/mongo:8`

## Setup

```bash
npm install                 # the server's packages, in the repo root
cd client && npm install    # the Angular app's packages
cd ..
npm run seed                # loads the demo data in data/ into MongoDB
```

`npm run seed` clears the database first, so it always gives the same starting state.

## Running it

Two terminals:

```bash
npm start                   # the API and socket.io server, http://localhost:3000
```

```bash
cd client
npx ng serve                # the app, http://localhost:4200
```

To use a different database, set `MONGO_URL` (default `mongodb://localhost:27017`) and `DB_NAME`
(default `fabulari`) before `npm start` and `npm run seed`.

## Demo accounts

All three have the password `pw123`.

| Email | Role |
|---|---|
| `test@test.com` | The super admin |
| `jack@123` | Admin of Book Club, Robotics (16+) and Film Club (18+) |
| `hello@hello.com` | A member of Book Club, 14 years old, so the age limits refuse them |

To try the chat with two people, log in as `jack@123` and `hello@hello.com` in two different
browsers (or one normal and one private window, since tabs share the login) and open Book Club's
General room in both.

## Tests

| Suite | Command | Needs |
|---|---|---|
| Server integration tests | `npm test` (repo root) | MongoDB. Uses its own test databases and drops them afterwards |
| Client unit tests | `cd client && npx ng test --watch=false` | Nothing else running |
| End to end (Cypress) | `cd client && npx cypress run` | MongoDB, `npm start`, `ng serve`, and the seeded super admin |

The end to end tests create their own accounts and groups with a timestamp in the name, so they can
run again and again, but they leave that data behind. Run `npm run seed` afterwards for a clean demo.
`npx cypress open` shows the tests running in a browser instead.

## Layout

```
server.js            Express routes, socket.io events, MongoDB access
seed.js              loads data/*.json into MongoDB
data/                the demo data
test/                server integration tests (node --test)
uploads/             uploaded images, created on start, not in git
client/src/app/      the Angular app: one folder per page, plus the services and guards
client/cypress/      end to end tests
design/              wireframes
Phase2.md            requirements, API, Angular architecture, design and testing
```
