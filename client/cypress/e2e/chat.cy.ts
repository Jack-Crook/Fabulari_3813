// end to end tests for the chat room: socket.io messages, the live presence list, the join and
// leave notices, history, image messages, and the membership check.
//
// cypress controls one browser, which is one person. the second person in the room is played
// by the socket tasks in cypress.config.ts, which connect to the server from node with
// socket.io-client, the same library the angular app uses. so the browser user and the task
// user are two real clients of the server, and a message from one showing up for the other
// means it really went through the server and wasn't just drawn on the sender's own screen.

import { SUPER, newUser, register, visitAs, createGroup, createRoom, joinGroup, unique } from '../support/helpers';

describe('Chat room', () => {
  const admin = newUser('chatadmin');
  const member = newUser('chatmember');
  const outsider = newUser('outsider');
  let channelId: string;
  let roomPage: string;

  before(() => {
    register(admin);
    register(member);
    register(outsider);
    createGroup(admin, `E2E Chat ${unique()}`).then(group => {
      joinGroup(group._id, member);
      createRoom(group._id, 'General', admin).then(room => {
        channelId = room._id;
        roomPage = `/groups/${group._id}/channels/${room._id}`;
      });
    });
  });

  // types a message and presses Enter, which submits the form like the Send button does. Enter
  // only submits while Send is enabled, and Send only enables once angular has redrawn after the
  // typing. cypress types far faster than a person, so it waits for that before pressing Enter.
  function sendFromBrowser(text: string) {
    cy.get('input[name="draft"]').type(text);
    cy.contains('.composer button', 'Send').should('not.be.disabled');
    cy.get('input[name="draft"]').type('{enter}');
  }

  // the task socket is left open if a test fails halfway, so it's always closed afterwards
  afterEach(() => {
    cy.task('socketLeave', { email: member.email });
  });

  it('sends a message and shows it in the room', () => {
    visitAs(admin, roomPage);
    cy.contains('.chat-banner h1', 'General').should('be.visible');

    // the joiner is in the live list once the server has accepted the join
    cy.contains('.presence-sidebar', admin.email).should('be.visible');

    sendFromBrowser('Hello from Cypress');

    cy.contains('.message-row.mine', 'Hello from Cypress').within(() => {
      // the spec asks for an indicator when the sender is the group's admin
      cy.get('.admin-tag').should('contain', 'Admin');
    });
    cy.get('input[name="draft"]').should('have.value', '');
  });

  it('keeps the history after a reload', () => {
    // messages are stored in mongo, and joining a room sends back the last 50
    visitAs(admin, roomPage);
    cy.contains('.message-row', 'Hello from Cypress').should('be.visible');
  });

  it('shows another user arriving, talking and leaving, live', () => {
    visitAs(admin, roomPage);
    cy.contains('.presence-sidebar', admin.email).should('be.visible');

    // the second person joins. the ack is what the server sends a joiner: history and who's here.
    cy.task('socketJoin', { channelId, email: member.email }).then((ack: any) => {
      expect(ack.error).to.be.undefined;
      expect(ack.present).to.include(admin.email);
      expect(ack.history.map((m: { body: string }) => m.body)).to.include('Hello from Cypress');
    });

    // the spec wants both: a live list of who's in the room, and a notice when someone arrives
    cy.contains('.presence-sidebar', member.email).should('be.visible');
    cy.get('.notice').should('contain', `${member.email} joined`);

    // their message arrives in the browser, under their display name, on the other side
    cy.task('socketSend', { email: member.email, body: 'Hi from the other user' })
      .its('ok').should('equal', true);
    cy.contains('.message-row:not(.mine)', 'Hi from the other user')
      .should('contain', member.username);

    // and the browser user's message reaches them
    sendFromBrowser('Can you see this?');
    cy.contains('.message-row.mine', 'Can you see this?').should('be.visible');
    cy.task('socketReceived', { email: member.email }).should('include', 'Can you see this?');

    // closing their connection counts as leaving
    cy.task('socketLeave', { email: member.email });
    cy.get('.notice').should('contain', `${member.email} left`);
    cy.contains('.presence-sidebar', member.email).should('not.exist');
  });

  it('sends an image', () => {
    visitAs(admin, roomPage);
    cy.contains('.presence-sidebar', admin.email).should('be.visible');

    // the real file input is hidden behind the Image button, so force is needed to use it.
    // picking a file uploads it straight away and shows a preview before it's sent.
    cy.get('.composer input[type="file"]').selectFile('cypress/fixtures/test-image.png', { force: true });
    cy.get('.pending-image img').should('be.visible');

    cy.contains('.composer button', 'Send').click();

    // naturalWidth above 0 means the browser actually loaded the file from the server
    cy.get('.message-row.mine img.message-image').last()
      .should('be.visible')
      .and($img => expect(($img[0] as HTMLImageElement).naturalWidth).to.be.greaterThan(0));
    cy.get('.pending-image').should('not.exist');
  });

  it("refuses someone who isn't a member of the group", () => {
    visitAs(outsider, roomPage);

    // the server checks membership before letting a socket into the room
    cy.get('.chat-error').should('contain', 'You are not a member of this group');
    cy.get('.composer').should('not.exist');
    cy.contains('.message-row', 'Hello from Cypress').should('not.exist');
  });

  it("doesn't let the super admin post, since they're never a member", () => {
    visitAs(SUPER, roomPage);
    cy.get('.chat-error').should('contain', 'You are not a member of this group');
    cy.get('.composer').should('not.exist');
  });
});
