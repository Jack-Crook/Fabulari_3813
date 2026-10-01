// e2e: request a group, super admin approves or rejects (with a reason), then join, age limit and leave.
// the first block runs in order on one group.

import { API, SUPER, newUser, register, visitAs, unique } from '../support/helpers';

describe('Groups and requests', () => {
  const owner = newUser('owner');
  const joiner = newUser('joiner');
  const kid = newUser('kid', '2015-01-01');    // under the 18+ limit
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
      // not created yet, waiting on the super admin
      cy.contains('.pending-row', `Create group "${groupName}"`).should('be.visible');
      cy.contains('.my-groups .group-row', groupName).should('not.exist');
    });

    it('refuses a second request for the same name', () => {
      visitAs(owner, '/user-dashboard');

      cy.contains('button', 'Request Group').click();
      cy.get('#new-name').type(groupName);
      cy.contains('button', 'Send Request').click();

      // names are unique, including pending ones
      cy.get('[role="alert"]').should('contain', 'already been requested');
    });

    it('is approved by the super admin', () => {
      visitAs(SUPER, '/super-admin-dashboard');

      // a new group needs no confirm step
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

    it('lets an adult find it in Discover and ask to join', () => {
      visitAs(joiner, '/user-dashboard');

      // filters as you type
      cy.get('.discover-search').type(groupName);
      cy.get('.discover-row').should('have.length', 1);
      cy.contains('.discover-row', groupName).within(() => {
        cy.contains('button', 'Request to join').click();
      });

      // not in yet: it waits for an admin, and the button says it's been asked
      cy.get('[role="status"]').should('contain', `Asked to join ${groupName}`);
      cy.contains('.pending-row', `Join "${groupName}"`).should('be.visible');
      cy.contains('.discover-row', groupName).contains('button', 'Requested').should('be.disabled');
      cy.contains('.my-groups .group-row', groupName).should('not.exist');
    });

    it('shows a new join request on the admin page live, without a reload', () => {
      cy.request(`${API}/groups`).then(({ body: groups }) => {
        const group = groups.find((g: { name: string }) => g.name === groupName);
        visitAs(owner, `/admin-dashboard/${group._id}`);
        cy.contains('h2', 'Requests').should('be.visible');

        // someone asks to join while the admin has the page open: the socket tells the page,
        // and the request appears in the panel
        const latecomer = newUser('latecomer');
        register(latecomer);
        cy.request('POST', `${API}/requests`, { type: 'group-join', requestedBy: latecomer.email, groupId: group._id });
        cy.contains('.admin-side .request-row', latecomer.email).should('be.visible');
      });
    });

    it('lets the group\'s admin approve the request, and then they\'re in', () => {
      cy.request(`${API}/groups`).then(({ body: groups }) => {
        const group = groups.find((g: { name: string }) => g.name === groupName);
        visitAs(owner, `/admin-dashboard/${group._id}`);
      });
      // the joiner's row: the latecomer from the test above is waiting too
      cy.contains('.admin-side .request-row', joiner.email).within(() => {
        cy.contains('button', 'Approve').click();
      });
      cy.get('[role="status"]').should('contain', `Approved: Join "${groupName}"`);
      cy.contains('.members-table', joiner.email).should('be.visible');

      visitAs(joiner, '/user-dashboard');
      cy.contains('.my-groups .group-row', groupName).should('be.visible');
    });

    it('auto rejects a user under the age limit', () => {
      visitAs(kid, '/user-dashboard');

      // every group is visible whatever your age...
      cy.get('.discover-search').type(groupName);
      cy.contains('.discover-row', groupName).within(() => {
        cy.contains('button', 'Request to join').click();
      });

      // ...but asking is rejected straight away, no admin needed, and they're told why
      cy.get('[role="alert"]').should('contain', 'You must be at least 18');
      cy.contains('.my-groups .group-row', groupName).should('not.exist');
      cy.contains('.pending-row', groupName).should('not.exist');
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
      // raised through the api, the form is tested above
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
        // an empty reason gets a 400
        cy.contains('button', 'Confirm').click();
      });
      cy.get('[role="alert"]').should('contain', 'A reason is required');

      cy.contains('.request-row', rejectedName).within(() => {
        cy.get('input[name="reject-reason"]').type('Too similar to an existing group');
        cy.contains('button', 'Confirm').click();
      });
      cy.get('[role="status"]').should('contain', `Rejected: Create group "${rejectedName}"`);

      // the requester sees the reason on their profile
      visitAs(owner, '/profile');
      cy.contains('.request-card.rejected', rejectedName)
        .should('contain', 'Reason: Too similar to an existing group');
    });
  });
});
