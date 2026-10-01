// e2e: register, login, logout. nothing mocked: a real browser, angular, express and mongo.
// needs mongod, `npm start` and `ng serve` running.

// a new account each run (timestamp in the email), shared by the tests below
const stamp = Date.now();
const user = {
  email: `e2e.${stamp}@test.com`,
  username: `e2e${stamp}`,
  password: 'secret123',
};

// fills in and submits the login form
function logIn(email: string, password: string) {
  cy.visit('/login');
  cy.get('#email').type(email);
  cy.get('#password').type(password);
  cy.contains('button', 'Log In').click();
}

describe('Authentication', () => {
  // the first test makes the account the others use. cypress runs them in order.

  it('registers a new account through the form', () => {
    cy.visit('/register');
    cy.get('#email').type(user.email);
    cy.get('#username').type(user.username);
    cy.get('#password').type(user.password);
    cy.contains('button', 'Register').click();

    // success message, and the form clears
    cy.get('[role="status"]').should('contain', 'Registered successfully');
    cy.get('#email').should('have.value', '');
  });

  it('refuses to register the same email twice', () => {
    cy.visit('/register');
    cy.get('#email').type(user.email);
    cy.get('#password').type(user.password);
    cy.contains('button', 'Register').click();

    // the 409 message. role="alert" also means a screen reader announces it.
    cy.get('[role="alert"]').should('contain', 'Email is already registered');
  });

  it('logs in with the new account and lands on the dashboard', () => {
    logIn(user.email, user.password);

    // login redirects after 1s, cy.url() retries for up to 4s
    cy.url().should('include', '/user-dashboard');

    // the session, never with a password in it
    cy.window().then(win => {
      const stored = JSON.parse(win.localStorage.getItem('user') ?? '{}');
      expect(stored.email).to.equal(user.email);
      expect(stored.role).to.equal('user');
      expect(stored).not.to.have.property('password');
    });

    // the account button names who is signed in
    cy.get('.account-button').should('have.attr', 'aria-label', `Account: ${user.username}`);
  });

  it('rejects a wrong password and stays on the login page', () => {
    logIn(user.email, 'not-the-password');

    // the same 401 whether or not the email exists
    cy.get('[role="alert"]').should('contain', 'Invalid email or password');
    cy.url().should('include', '/login');
    cy.window().its('localStorage').invoke('getItem', 'user').should('be.null');
  });

  it('logs out from the account menu and clears the session', () => {
    logIn(user.email, user.password);
    cy.url().should('include', '/user-dashboard');

    // logout is in the account menu
    cy.get('.account-button').click();
    cy.contains('#account-menu button', 'Logout').click();

    cy.url().should('include', '/login');
    cy.window().its('localStorage').invoke('getItem', 'user').should('be.null');

    // the guard now bounces the dashboard back to login
    cy.visit('/user-dashboard');
    cy.url().should('include', '/login');
  });
});
