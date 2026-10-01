// end to end tests for getting a group made and getting into it.
//
// the spec says a group can't be created directly: a user requests it with all of its details,
// the super admin approves or rejects it (a rejection needs a reason), and the requester becomes
// its first admin. after that anyone can see it in Discover and join, unless they are under its
// age limit, in which case the join is refused automatically.
//
// the tests in the first block run in order and share one group, the way a real one would go
// from requested to approved to joined. cypress runs a file top to bottom, which makes that safe.

import { API, SUPER, newUser, register, visitAs, unique } from '../support/helpers';

describe('Groups and requests', () => {
  const owner = newUser('owner');
  const joiner = newUser('joiner');
  const kid = newUser('kid', '2015-01-01');    // well under the 18+ limit the group gets below
  const groupName = `E2E Group ${unique()}`;

  before(() => {
    register(owner);
    register(joiner);
    register(kid);
  });

  describe('request, approve, join', () => {
    it('requests a new group from the dashboard', () => {
      visitAs(owner, '/user-dashboard');

      cy.contains('button', 'Request Group').click();
      cy.get('#new-name').type(groupName);
      cy.get('#new-description').type('A group made by Cypress');
      cy.get('#new-age').clear().type('18');
      cy.contains('button', 'Send Request').click();

      cy.get('[role="status"]').should('contain', `Requested "${groupName}"`);
      // it doesn't exist yet, it's waiting on the super admin, and the dashboard says so
      cy.contains('.pending-row', `Create group "${groupName}"`).should('be.visible');
      cy.contains('.my-groups .group-row', groupName).should('not.exist');
    });

    it('refuses a second request for the same name', () => {
      visitAs(owner, '/user-dashboard');

      cy.contains('button', 'Request Group').click();
      cy.get('#new-name').type(groupName);
      cy.contains('button', 'Send Request').click();

      // group names are unique, including against ones that are only requested so far
      cy.get('[role="alert"]').should('contain', 'already been requested');
    });

    it('is approved by the super admin', () => {
      visitAs(SUPER, '/super-admin-dashboard');

      // a new group isn't irreversible, so approving it goes straight through with no confirm step
      cy.contains('.request-row', groupName).within(() => {
        cy.contains('button', 'Approve').click();
      });

      cy.get('[role="status"]').should('contain', `Approved: Create group "${groupName}"`);
      cy.contains('.request-row', groupName).should('not.exist');
    });

    it('makes the requester its first admin', () => {
      visitAs(owner, '/user-dashboard');

      cy.contains('.my-groups .group-row', groupName)
        .should('contain', 'Admin')
        .and('contain', '18+');
      cy.contains('.pending-row', groupName).should('not.exist');
    });

    it('lets an adult find it in Discover and join', () => {
      visitAs(joiner, '/user-dashboard');

      // the search box narrows the list as you type
      cy.get('.discover-search').type(groupName);
      cy.get('.discover-row').should('have.length', 1);
      cy.contains('.discover-row', groupName).within(() => {
        cy.contains('button', 'Join').click();
      });

      cy.get('[role="status"]').should('contain', `Joined ${groupName}.`);
      cy.contains('.my-groups .group-row', groupName).should('be.visible');
    });

    it('auto rejects a user under the age limit', () => {
      visitAs(kid, '/user-dashboard');

      // the spec says every group is visible whatever your age, so it is listed...
      cy.get('.discover-search').type(groupName);
      cy.contains('.discover-row', groupName).within(() => {
        cy.contains('button', 'Join').click();
      });

      // ...but joining is refused by the server with the reason
      cy.get('[role="alert"]').should('contain', 'You must be at least 18');
      cy.contains('.my-groups .group-row', groupName).should('not.exist');
    });

    it('lets a member leave', () => {
      visitAs(joiner, '/user-dashboard');

      cy.contains('.group-row-wrap', groupName).within(() => {
        cy.contains('button', 'Leave').click();
      });

      cy.get('[role="status"]').should('contain', `Left ${groupName}.`);
      cy.contains('.my-groups .group-row', groupName).should('not.exist');
    });
  });

  describe('rejecting a request', () => {
    const rejectedName = `E2E Rejected ${unique()}`;

    before(() => {
      // raised through the api, because the request form was already tested above
      cy.request('POST', `${API}/requests`, {
        type: 'group-create',
        requestedBy: owner.email,
        payload: { name: rejectedName, description: '', ageLimit: 0, theme: '#5FA8D3' },
      });
    });

    it('needs a reason, which the requester then sees on their profile', () => {
      visitAs(SUPER, '/super-admin-dashboard');

      cy.contains('.request-row', rejectedName).within(() => {
        cy.contains('button', 'Reject').click();
        // confirming with the box empty: the server answers 400, the spec says a reason is required
        cy.contains('button', 'Confirm').click();
      });
      cy.get('[role="alert"]').should('contain', 'A reason is required');

      cy.contains('.request-row', rejectedName).within(() => {
        cy.get('input[name="reject-reason"]').type('Too similar to an existing group');
        cy.contains('button', 'Confirm').click();
      });
      cy.get('[role="status"]').should('contain', `Rejected: Create group "${rejectedName}"`);

      // the requester can see their own past rejected requests, with the reason
      visitAs(owner, '/profile');
      cy.contains('.request-card.rejected', rejectedName)
        .should('contain', 'Reason: Too similar to an existing group');
    });
  });
});
