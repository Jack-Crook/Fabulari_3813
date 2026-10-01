// shared setup for the e2e specs.
//
// a spec should only drive the UI for the thing it is actually testing. everything it needs to
// exist first (an account, a group, a room) is made here by calling the api directly with
// cy.request, which is quicker than clicking through forms and means a spec doesn't break
// because some other page it only passes through has changed.
//
// every account and group gets a timestamp in its name, so the specs don't depend on what is
// already in the database and can be run over and over without "already exists" errors. the one
// exception is the super admin: there is exactly one, nobody can register as it, so the specs
// use the one `npm run seed` creates from data/users.json.

export const API = 'http://localhost:3000';

export const SUPER = { email: 'test@test.com', password: 'pw123' };

export interface TestUser {
  email: string;
  username: string;
  password: string;
  dob: string;
}

// the parts of a group the specs read back. matches the Group interface in src/app/group.ts.
export interface TestGroup {
  _id: string;
  name: string;
  adminEmails: string[];
  memberEmails: string[];
}

// Date.now() alone can repeat when two accounts are made in the same millisecond, so a counter
// goes on the end as well
let counter = 0;
export function unique() {
  return `${Date.now()}${counter++}`;
}

// an adult by default. the age limit specs pass a recent date of birth to get an under-age user.
export function newUser(tag: string, dob = '1995-06-15'): TestUser {
  const id = unique();
  return {
    email: `e2e.${tag}.${id}@test.com`,
    username: `${tag}${id}`,
    password: 'secret123',
    dob,
  };
}

export function register(user: TestUser) {
  return cy.request('POST', `${API}/register`, user);
}

// signs in through the api and opens a page as that user. the login form itself is covered in
// auth.cy.ts, so the other specs skip it: login.ts saves this same object to localStorage, and
// that is all the app reads to know who is signed in. onBeforeLoad writes it before angular
// starts, so the route guards see a signed in user on the very first navigation.
export function visitAs(user: { email: string; password: string }, path: string) {
  return cy.request('POST', `${API}/login`, { email: user.email, password: user.password })
    .then(({ body }) => {
      cy.visit(path, {
        onBeforeLoad(win) {
          win.localStorage.setItem('user', JSON.stringify({
            email: body.email,
            role: body.role,
            username: body.username,
            avatarUrl: body.avatarUrl,
          }));
        },
      });
    });
}

// a group can only be made the way the app makes one: the owner raises a group-create request and
// the super admin approves it. then the new group is read back, because the approve route returns
// the request, not the group, and the specs need its _id.
export function createGroup(owner: TestUser, name: string, ageLimit = 0): Cypress.Chainable<TestGroup> {
  return cy.request('POST', `${API}/requests`, {
    type: 'group-create',
    requestedBy: owner.email,
    payload: { name, description: 'Made by a Cypress test', ageLimit, theme: '#5FA8D3' },
  })
    .then(({ body: request }) =>
      cy.request('POST', `${API}/requests/${request._id}/approve`, { actorEmail: SUPER.email }))
    .then(() => cy.request(`${API}/groups`))
    .then(({ body: groups }) => (groups as TestGroup[]).find(g => g.name === name)!);
}

// a room made by the group's admin directly, which is allowed without a proposal
export function createRoom(groupId: string, name: string, admin: TestUser): Cypress.Chainable<{ _id: string }> {
  return cy.request('POST', `${API}/channels`, { groupId, name, actorEmail: admin.email })
    .then(({ body }) => body);
}

export function joinGroup(groupId: string, user: TestUser) {
  return cy.request('POST', `${API}/groups/${groupId}/members`, { email: user.email, actorEmail: user.email });
}
