// end to end tests for running a group: the group admin's dashboard, plus the two things a
// group admin has to ask the super admin for, a permanent ban and deleting the group.
//
// one group is made for the whole file and the tests run in order against it, ending with it
// being deleted. the people in it are made fresh each run, so nothing depends on the seed data
// except the super admin account.

import { API, SUPER, newUser, register, visitAs, createGroup, joinGroup, unique, TestGroup } from '../support/helpers';

describe('Group admin', () => {
  const admin = newUser('admin');
  const member = newUser('member');
  const minor = newUser('minor', '2012-02-03');    // fine with no age limit, too young once it's 16
  const groupName = `E2E Admin ${unique()}`;
  let group: TestGroup;
  let adminPage: string;

  // the member's row in the members table. the first <tr> with their email is their own row,
  // the remove and ban boxes drop in as extra rows underneath it.
  const memberRow = () => cy.contains('.members-table tbody tr', member.email);

  before(() => {
    register(admin);
    register(member);
    register(minor);
    createGroup(admin, groupName).then(created => {
      group = created;
      adminPage = `/admin-dashboard/${group._id}`;
      joinGroup(group._id, member);
      joinGroup(group._id, minor);
    });
  });

  it('opens the admin page from the group page', () => {
    visitAs(admin, `/groups/${group._id}`);

    // only shown to an admin of this group
    cy.contains('a', 'Manage this group').click();
    cy.url().should('include', adminPage);
    cy.contains('h2', 'Group Settings').should('be.visible');
  });

  it('edits the settings, and raising the age limit removes an under-age member', () => {
    visitAs(admin, adminPage);
    cy.contains('.members-table', minor.email).should('exist');

    cy.contains('button', 'Edit').click();
    cy.get('#edit-description').clear().type('Edited by Cypress');
    cy.get('#edit-age').clear().type('16');
    cy.contains('button', 'Save Changes').click();

    // the spec says raising the age limit boots members who no longer meet it. the server
    // sends back who went, and the page says so.
    cy.get('[role="status"]')
      .should('contain', '1 member(s) removed')
      .and('contain', minor.email);
    cy.get('.setting-description').should('contain', 'Edited by Cypress');
    cy.contains('.setting-pill', 'Age Limit: 16').should('be.visible');
    cy.contains('.members-table', minor.email).should('not.exist');
  });

  it('creates, renames and deletes a room', () => {
    visitAs(admin, adminPage);

    cy.get('#new-room').type('Planning');
    cy.contains('button', 'Add Room').click();
    cy.get('[role="status"]').should('contain', 'Room "Planning" created.');

    // not inside .within(): the row is found by its name, and clicking Rename swaps the name for
    // an input, so the row stops matching. only one room is ever being renamed, so the input
    // and its buttons are unique on the page anyway.
    cy.contains('.room-row', 'Planning').contains('button', 'Rename').click();
    cy.get('input[name="rename"]').clear().type('Planning 2');
    cy.get('.rename-room').contains('button', 'Save').click();
    cy.get('[role="status"]').should('contain', 'Room renamed to "Planning 2".');

    // deleting takes every message with it, so it asks first. focus lands on Cancel, so pressing
    // Enter straight away backs out rather than deleting.
    cy.contains('.room-row', 'Planning 2').contains('button', 'Delete').click();
    cy.get('.confirm-box .confirm-text').should('contain', "This can't be undone");
    cy.focused().should('have.text', 'Cancel');
    cy.get('.confirm-box').contains('button', 'Cancel').click();
    cy.contains('.room-name', 'Planning 2').should('be.visible');    // cancelled, so still there

    cy.contains('.room-row', 'Planning 2').contains('button', 'Delete').click();
    cy.get('.confirm-box').contains('button', 'Delete room').click();
    cy.get('[role="status"]').should('contain', 'Room "Planning 2" deleted.');
    cy.contains('.room-name', 'Planning 2').should('not.exist');
  });

  it("approves a member's room proposal", () => {
    // a regular member can't create a room, they propose one from the group page
    visitAs(member, `/groups/${group._id}`);
    cy.get('input[name="proposed"]').type('Ideas');
    cy.contains('button', 'Propose').click();
    cy.get('[role="status"]').should('contain', 'Proposed "Ideas"');
    cy.contains('.proposed-row', 'Ideas').should('be.visible');

    // and an admin of the group approves it
    visitAs(admin, adminPage);
    cy.contains('.admin-side .request-row', 'Ideas').within(() => {
      cy.contains('button', 'Approve').click();
    });
    cy.get('[role="status"]').should('contain', 'Approved: Create room "Ideas"');
    cy.contains('.room-row', 'Ideas').should('be.visible');
  });

  it('promotes a member to admin and demotes them again', () => {
    visitAs(admin, adminPage);

    memberRow().within(() => cy.contains('button', 'Promote').click());
    cy.get('[role="status"]').should('contain', `${member.email} is now an admin of this group.`);
    memberRow().should('contain', 'Admin');

    // there are two admins now, so demoting one leaves the group with an admin, which is allowed
    memberRow().within(() => cy.contains('button', 'Demote').click());
    memberRow().should('contain', 'Member');
  });

  it('bans a member from the group and lifts it', () => {
    visitAs(admin, adminPage);

    memberRow().within(() => cy.contains('button', 'Ban…').click());
    cy.get('input[name="ban-reason"]').type('Spamming the rooms');
    cy.contains('button', 'Ban from this group').click();

    cy.get('[role="status"]').should('contain', `${member.email} is banned from this group.`);
    cy.contains('.members-table', member.email).should('not.exist');
    cy.contains('.room-row', member.email).should('be.visible');    // in the banned list

    // a group ban isn't permanent, unlike a system wide one
    cy.contains('.room-row', member.email).within(() => cy.contains('button', 'Lift Ban').click());
    cy.get('[role="status"]').should('contain', `Ban on ${member.email} lifted.`);
    cy.contains('p', 'Nobody is banned from this group.').should('be.visible');
  });

  it('reports a member, and the super admin bans them permanently', () => {
    // lifting the ban doesn't put them back in the group, so they rejoin to be in the table again
    joinGroup(group._id, member);

    visitAs(admin, adminPage);
    memberRow().within(() => cy.contains('button', 'Ban…').click());
    cy.get('input[name="ban-reason"]').type('Abusive messages');
    cy.contains('button', 'Report for permanent ban').click();
    cy.get('[role="status"]').should('contain', `${member.email} reported to the super admin for a permanent ban.`);

    visitAs(SUPER, '/super-admin-dashboard');
    cy.contains('.request-row', `Permanently ban ${member.email}`).within(() => {
      cy.contains('Reported for: Abusive messages').should('be.visible');

      // irreversible, so it asks first and says what will happen
      cy.contains('button', 'Approve').click();
      cy.get('.confirm-text').should('contain', 'can never register again');
      cy.focused().should('have.text', 'Cancel');
      cy.contains('button', 'Yes, approve').click();
    });
    cy.get('[role="status"]').should('contain', `Approved: Permanently ban ${member.email}`);
    cy.contains('.data-table tr', member.email).should('contain', 'Abusive messages');

    // the account is gone and the email can never be registered again
    cy.visit('/register');
    cy.get('#email').type(member.email);
    cy.get('#password').type(member.password);
    cy.contains('button', 'Register').click();
    cy.get('[role="alert"]').should('contain', 'permanently banned');
  });

  it('requests the group be deleted, and the super admin approves it', () => {
    visitAs(admin, adminPage);
    // a group admin can't delete their own group, they ask the super admin
    cy.contains('button', 'Request Group Deletion').click();
    cy.get('[role="status"]').should('contain', 'Deletion requested.');

    visitAs(SUPER, '/super-admin-dashboard');
    cy.contains('.request-row', `Delete group "${groupName}"`).within(() => {
      cy.contains('button', 'Approve').click();
      cy.get('.confirm-text').should('contain', 'every message in them');
      cy.contains('button', 'Yes, approve').click();
    });
    cy.get('[role="status"]').should('contain', `Approved: Delete group "${groupName}"`);

    // gone for the admin too, and its page says so rather than showing an empty group
    visitAs(admin, '/user-dashboard');
    cy.contains('.my-groups .group-row', groupName).should('not.exist');
    cy.request(`${API}/groups`).its('body').then(groups => {
      expect(groups.map((g: TestGroup) => g.name)).not.to.include(groupName);
    });
    visitAs(admin, `/groups/${group._id}`);
    cy.contains('Group not found.').should('be.visible');
  });
});
