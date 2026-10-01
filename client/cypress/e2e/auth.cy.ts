// end to end tests for signing up, logging in and logging out.
//
// unlike the vitest specs, nothing here is mocked. cypress drives a real browser against the real
// angular app (ng serve on :4200), which talks to the real express server (:3000) and the real
// mongo database. so a pass means the whole chain works: the form, the http call, the route, the
// bcrypt hash, the database write, and the redirect afterwards.
//
// needs all three running first: mongod, `npm start` in the repo root, and `ng serve` in client/.

// every run registers a brand new account, with the time in the email so it can't already exist.
// that way these tests don't depend on what's in the database, and running them twice in a row
// doesn't fail with "Email is already registered". the account is shared by the tests below.
const stamp = Date.now();
const user = {
  email: `e2e.${stamp}@test.com`,
  username: `e2e${stamp}`,
  password: 'secret123',
};

// fills in and submits the login form. the ids are the same ones the <label for> points at.
function logIn(email: string, password: string) {
  cy.visit('/login');
  cy.get('#email').type(email);
  cy.get('#password').type(password);
  cy.contains('button', 'Log In').click();
}

describe('Authentication', () => {
  // the first test creates the account the others log in with, so they have to run in order.
  // cypress runs the tests in a file top to bottom, which is what makes this safe.

  it('registers a new account through the form', () => {
    cy.visit('/register');
    cy.get('#email').type(user.email);
    cy.get('#username').type(user.username);
    cy.get('#password').type(user.password);
    cy.contains('button', 'Register').click();

    // the server answered 201 and the page said so. the form clears itself on success, which is
    // a second sign it really went through rather than the message being left over.
    cy.get('[role="status"]').should('contain', 'Registered successfully');
    cy.get('#email').should('have.value', '');
  });

  it('refuses to register the same email twice', () => {
    cy.visit('/register');
    cy.get('#email').type(user.email);
    cy.get('#password').type(user.password);
    cy.contains('button', 'Register').click();

    // the 409 from POST /register, shown word for word. role="alert" is what the page uses for
    // errors, so this also checks a screen reader would announce it.
    cy.get('[role="alert"]').should('contain', 'Email is already registered');
  });

  it('logs in with the new account and lands on the dashboard', () => {
    logIn(user.email, user.password);

    // login waits a second before redirecting so the success message can be read. cy.url()
    // retries for up to 4 seconds, so it waits that out without a fixed sleep.
    cy.url().should('include', '/user-dashboard');

    // the session the rest of the app reads. the password must never be in it, the server
    // doesn't send it back and login.ts only keeps email, role, username and avatarUrl.
    cy.window().then(win => {
      const stored = JSON.parse(win.localStorage.getItem('user') ?? '{}');
      expect(stored.email).to.equal(user.email);
      expect(stored.role).to.equal('user');
      expect(stored).not.to.have.property('password');
    });

    // the navbar's account button is labelled with whoever is signed in
    cy.get('.account-button').should('have.attr', 'aria-label', `Account: ${user.username}`);
  });

  it('rejects a wrong password and stays on the login page', () => {
    logIn(user.email, 'not-the-password');

    // the same 401 message whether the email exists or not, so the page can't be used to find
    // out who has an account
    cy.get('[role="alert"]').should('contain', 'Invalid email or password');
    cy.url().should('include', '/login');
    cy.window().its('localStorage').invoke('getItem', 'user').should('be.null');
  });

  it('logs out from the account menu and clears the session', () => {
    logIn(user.email, user.password);
    cy.url().should('include', '/user-dashboard');

    // logout lives inside the account menu, so the menu has to be opened first
    cy.get('.account-button').click();
    cy.contains('#account-menu button', 'Logout').click();

    cy.url().should('include', '/login');
    cy.window().its('localStorage').invoke('getItem', 'user').should('be.null');

    // and the session really is gone: the auth guard now bounces the dashboard back to login
    cy.visit('/user-dashboard');
    cy.url().should('include', '/login');
  });
});
