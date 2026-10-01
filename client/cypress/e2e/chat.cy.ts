// e2e: chat messages, presence, join/leave notices, history, images and the membership check.
// the second user is played by socket tasks in cypress.config.ts, a real second client.

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

  // Enter only submits once Send is enabled, and cypress types faster than angular redraws
  function sendFromBrowser(text: string) {
    cy.get('input[name="draft"]').type(text);
    cy.contains('.composer button', 'Send').should('not.be.disabled');
    cy.get('input[name="draft"]').type('{enter}');
  }

  // close the task socket even if a test fails
  afterEach(() => {
    cy.task('socketLeave', { email: member.email });
  });

  it('sends a message and shows it in the room', () => {
    visitAs(admin, roomPage);
    cy.contains('.chat-banner h1', 'General').should('be.visible');

    // in the list once the server accepted the join
    cy.contains('.presence-sidebar', admin.email).should('be.visible');

    sendFromBrowser('Hello from Cypress');

    cy.contains('.message-row.mine', 'Hello from Cypress').within(() => {
      // the admin indicator
      cy.get('.admin-tag').should('contain', 'Admin');
    });
    cy.get('input[name="draft"]').should('have.value', '');
  });

  it('keeps the history after a reload', () => {
    // stored in mongo, the join sends the last 50
    visitAs(admin, roomPage);
    cy.contains('.message-row', 'Hello from Cypress').should('be.visible');
  });

  it('shows another user arriving, talking and leaving, live', () => {
    visitAs(admin, roomPage);
    cy.contains('.presence-sidebar', admin.email).should('be.visible');

    // the second user joins. the ack has the history and who's here.
    cy.task('socketJoin', { channelId, email: member.email }).then((ack: any) => {
      expect(ack.error).to.be.undefined;
      expect(ack.present).to.include(admin.email);
      expect(ack.history.map((m: { body: string }) => m.body)).to.include('Hello from Cypress');
    });

    // the live list and the notice
    cy.contains('.presence-sidebar', member.email).should('be.visible');
    cy.get('.notice').should('contain', `${member.email} joined`);

    // their message shows under their name
    cy.task('socketSend', { email: member.email, body: 'Hi from the other user' })
      .its('ok').should('equal', true);
    cy.contains('.message-row:not(.mine)', 'Hi from the other user')
      .should('contain', member.username);

    // and the browser user's message reaches them
    sendFromBrowser('Can you see this?');
    cy.contains('.message-row.mine', 'Can you see this?').should('be.visible');
    cy.task('socketReceived', { email: member.email }).should('include', 'Can you see this?');

    // a disconnect counts as leaving
    cy.task('socketLeave', { email: member.email });
    cy.get('.notice').should('contain', `${member.email} left`);
    cy.contains('.presence-sidebar', member.email).should('not.exist');
  });

  it('sends an image', () => {
    visitAs(admin, roomPage);
    cy.contains('.presence-sidebar', admin.email).should('be.visible');

    // the file input is hidden, so force. it uploads straight away and shows a preview.
    cy.get('.composer input[type="file"]').selectFile('cypress/fixtures/test-image.png', { force: true });
    cy.get('.pending-image img').should('be.visible');

    cy.contains('.composer button', 'Send').click();

    // naturalWidth > 0 means the image really loaded
    cy.get('.message-row.mine img.message-image').last()
      .should('be.visible')
      .and($img => expect(($img[0] as HTMLImageElement).naturalWidth).to.be.greaterThan(0));
    cy.get('.pending-image').should('not.exist');
  });

  it("refuses someone who isn't a member of the group", () => {
    visitAs(outsider, roomPage);

    // the server checks membership on join
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
