// e2e: the route guards through a real router.
// guards only decide which page renders, the server enforces the rules.

import { API, SUPER, newUser, register, visitAs } from '../support/helpers';

describe('Route guards', () => {
  const user = newUser('guards');

  before(() => {
    register(user);
  });

  describe('when signed out', () => {
    // authGuard is on everything except login and register
    ['/user-dashboard', '/profile', '/super-admin-dashboard', '/groups/anything'].forEach(path => {
      it(`sends ${path} to the login page`, () => {
        cy.visit(path);
        cy.url().should('include', '/login');
      });
    });

    it('sends an unknown url to the login page', () => {
      // the ** wildcard
      cy.visit('/no-such-page');
      cy.url().should('include', '/login');
    });
  });

  describe('as an ordinary user', () => {
    it('bounces them off the super admin dashboard', () => {
      visitAs(user, '/super-admin-dashboard');

      // signed in but not allowed, so back to their own dashboard
      cy.url().should('include', '/user-dashboard');
      cy.contains('.nav-links a', 'Super Admin').should('not.exist');
    });

    it("bounces them off the admin page of a group they don't admin", () => {
      // a new account admins nothing, so any group works. looked up, ids change on every seed.
      cy.request(`${API}/groups`).then(({ body: groups }) => {
        expect(groups, 'at least one group in the database').to.have.length.greaterThan(0);

        visitAs(user, `/admin-dashboard/${groups[0]._id}`);
        cy.url().should('include', '/user-dashboard');
      });
    });
  });

  describe('as the super admin', () => {
    it('lets them into the super admin dashboard', () => {
      visitAs(SUPER, '/super-admin-dashboard');

      cy.url().should('include', '/super-admin-dashboard');
      cy.contains('h2', 'Pending Requests').should('be.visible');
      cy.contains('.nav-links a', 'Super Admin').should('be.visible');
    });
  });
});
