// shared e2e setup. accounts, groups and rooms are made through the api, so a spec only clicks
// through what it tests. everything gets a timestamp, so runs don't depend on the database.
// the exception is the seeded super admin, since there's only one.

export const API = 'http://localhost:3000';

export const SUPER = { email: 'test@test.com', password: 'pw123' };

export interface TestUser {
  email: string;
  username: string;
  password: string;
  dob: string;
}

// matches Group in src/app/group.ts
export interface TestGroup {
  _id: string;
  name: string;
  adminEmails: string[];
  memberEmails: string[];
}

// a counter too, in case two are made in the same millisecond
let counter = 0;
export function unique() {
  return `${Date.now()}${counter++}`;
}

// an adult unless a date of birth is given
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

// logs in through the api and opens a page as that user, writing the same localStorage entry
// login.ts saves before angular starts (the login form is tested in auth.cy.ts)
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

// the app's way: request, then the super admin approves. the group is read back for its _id.
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

// an admin creates a room directly
export function createRoom(groupId: string, name: string, admin: TestUser): Cypress.Chainable<{ _id: string }> {
  return cy.request('POST', `${API}/channels`, { groupId, name, actorEmail: admin.email })
    .then(({ body }) => body);
}

// joining needs an admin's approval: the user asks, then an admin of the group approves it
export function joinGroup(groupId: string, user: TestUser, admin: TestUser) {
  return cy.request('POST', `${API}/requests`, { type: 'group-join', requestedBy: user.email, groupId })
    .then(({ body: request }) =>
      cy.request('POST', `${API}/requests/${request._id}/approve`, { actorEmail: admin.email }));
}
