# Fabulari

3813ICT Full Stack Development assignment: a real-time chat app on the MEAN stack (MongoDB, Express,
Angular, Node) with socket.io. Users join groups and chat in their rooms with text and images, and
group admins and a super admin manage everything through a request and approval flow.

The design and API documentation is in [`Phase2.md`](Phase2.md).

## Running it

Two terminals:

```bash
npm start                   # the API and socket.io server, http://localhost:3000
```

```bash
cd client
npx ng serve                # the app, http://localhost:4200
```



## Demo accounts

All three have the password `pw123`.

| Email | Role |
|---|---|
| `test@test.com` | The super admin |
| `jack@123` | Admin of Book Club, Robotics (16+) and Film Club (18+) |
| `hello@hello.com` | A member of Book Club, 14 years old, so the age limits refuse them |


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
design/              wireframes, and screens/ with the finished app
Phase2.md            requirements, API, Angular architecture, design and testing
```
