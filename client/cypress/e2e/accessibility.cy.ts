// e2e: every page checked by axe-core, the accessibility engine browser dev tools use, against
// WCAG 2.2 A and AA plus axe's best-practice rules. each page is checked at desktop width and at
// phone width, which also catches anything that makes the page scroll sideways on a phone.

import { SUPER, newUser, register, visitAs, createGroup, createRoom, joinGroup, unique } from '../support/helpers';

const RULES = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const WIDTHS: [number, number][] = [[1280, 800], [375, 812]];     // a laptop, and an iPhone-sized phone

// runs axe on the page as it is now and fails with a readable list of anything it finds
function checkPage(name: string) {
  cy.readFile('node_modules/axe-core/axe.min.js').then(axeSource => {
    cy.window().then(win => {
      (win as any).eval(axeSource);       // axe runs inside the page, like it would in dev tools
      return cy.wrap((win as any).axe.run(win.document, { runOnly: { type: 'tag', values: RULES } }), { timeout: 30000 });
    }).then((results: any) => {
      const found = results.violations.map((v: any) =>
        `${v.id} (${v.impact}): ${v.help} -> ${v.nodes.map((n: any) => n.target.join(' ')).slice(0, 3).join(', ')}`);
      expect(found, `axe violations on ${name}`).to.deep.equal([]);
    });
  });

  // nothing wider than the screen, or a phone has to scroll sideways
  cy.window().then(win => {
    expect(win.document.documentElement.scrollWidth, `${name} page width`).to.be.at.most(win.innerWidth);
  });
}

// opens a page at each width, waits for `ready` to be on the page, and checks it
function check(name: string, open: () => void, ready: string) {
  for (const [width, height] of WIDTHS) {
    cy.viewport(width, height);
    open();
    cy.get(ready, { timeout: 10000 }).should('exist');
    checkPage(`${name} at ${width}px`);
  }
}

describe('Accessibility', () => {
  const admin = newUser('a11yadmin');
  const member = newUser('a11ymember');
  const outsider = newUser('a11youtsider');
  let groupId = '';
  let channelId = '';

  before(() => {
    register(admin);
    register(member);
    register(outsider);
    createGroup(admin, `E2E A11y ${unique()}`).then(group => {
      groupId = group._id;
      joinGroup(group._id, member);
      createRoom(group._id, 'General', admin).then(room => {
        channelId = room._id;
      });
    });
  });

  afterEach(() => {
    cy.task('socketLeave', { email: member.email });
  });

  it('login and register, including an error message', () => {
    check('login', () => cy.visit('/login'), '#email');
    check('register', () => cy.visit('/register'), '#email');

    cy.visit('/login');
    cy.get('#email').type('nobody@test.com');
    cy.get('#password').type('wrong-password');
    cy.contains('button', 'Log In').click();
    cy.get('[role="alert"]').should('exist');
    checkPage('login with an error');
  });

  it('the dashboard, with the request form open', () => {
    check('dashboard', () => {
      visitAs(member, '/user-dashboard');
      cy.contains('button', 'Request Group').click();
    }, '#new-name');
  });

  it('a group page, as a member and as someone who isn\'t one', () => {
    check('group page (member)', () => visitAs(member, `/groups/${groupId}`), '.room-row');
    check('group page (non-member)', () => visitAs(outsider, `/groups/${groupId}`), '.join-bar');
  });

  it('a chat room with messages, a long link and someone else in it', () => {
    // a second person, and a message with a long unbroken link, which used to widen the chat
    cy.task('socketJoin', { channelId, email: member.email });
    cy.task('socketSend', { email: member.email, body: 'https://example.com/' + 'a'.repeat(150) });
    check('chat room', () => visitAs(admin, `/groups/${groupId}/channels/${channelId}`), '.message-row');
  });

  it('the group admin page', () => {
    check('admin page', () => visitAs(admin, `/admin-dashboard/${groupId}`), '.members-table');
  });

  it('the super admin page', () => {
    check('super admin page', () => visitAs(SUPER, '/super-admin-dashboard'), '.data-table');
  });

  it('the profile page, viewing and editing', () => {
    check('profile', () => visitAs(member, '/profile'), '.info-row');
    check('profile (editing)', () => {
      visitAs(member, '/profile');
      cy.contains('button', 'Edit').click();
    }, '#edit-username');
  });

  it('every page has its own title', () => {
    visitAs(member, '/user-dashboard');
    cy.title().should('equal', 'Dashboard | Fabulari');
    visitAs(member, `/groups/${groupId}`);
    cy.title().should('equal', 'Group | Fabulari');
  });
});
