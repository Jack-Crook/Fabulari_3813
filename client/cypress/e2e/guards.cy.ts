// end to end tests for the route guards in guards.ts.
//
// the vitest spec for guards.ts calls each guard as a function. this checks the same rules
// through a real router: type the url, see where the browser actually ends up.
//
// worth remembering in the interview: a guard only decides which page renders. the server
// checks every action again whatever page you're on, so these are about not showing someone a
// page full of controls that would all fail, not about security.

import { API, SUPER, newUser, register, visitAs } from '../support/helpers';

describe('Route guards', () => {
  const user = newUser('guards');

  before(() => {
    register(user);
  });

  describe('when signed out', () => {
    // authGuard is on every route except login and register
    ['/user-dashboard', '/profile', '/super-admin-dashboard', '/groups/anything'].forEach(path => {
      it(`sends ${path} to the login page`, () => {
        cy.visit(path);
        cy.url().should('include', '/login');
      });
    });

    it('sends an unknown url to the login page', () => {
      // the ** wildcard route, which would otherwise render a blank page
      cy.visit('/no-such-page');
      cy.url().should('include', '/login');
    });
  });

  describe('as an ordinary user', () => {
    it('bounces them off the super admin dashboard', () => {
      visitAs(user, '/super-admin-dashboard');

      // superAdminGuard sends them to their own dashboard rather than the login page, because
      // they are signed in, just not allowed this page
      cy.url().should('include', '/user-dashboard');
      cy.contains('.nav-links a', 'Super Admin').should('not.exist');
    });

    it("bounces them off the admin page of a group they don't admin", () => {
      // a brand new account admins nothing, so any group will do. the id is looked up rather
      // than hardcoded because it changes every time the database is seeded.
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
