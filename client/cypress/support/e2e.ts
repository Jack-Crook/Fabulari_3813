// ***********************************************************
// This example support/e2e.ts is processed and
// loaded automatically before your test files.
//
// This is a great place to put global configuration and
// behavior that modifies Cypress.
//
// You can change the location of this file or turn off
// automatically serving support files with the
// 'supportFile' configuration option.
//
// You can read more here:
// https://on.cypress.io/configuration
// ***********************************************************

// When a command from ./commands is ready to use, import with `import './commands'` syntax
// import './commands';

// the app's small entrance animations (animate.enter="fade-in") start from transparent. headless
// browsers don't always run css animations, which would leave a new message at opacity 0 and fail
// cypress's visibility checks, so they're switched off for the tests, the same as for a user who
// has asked their system for reduced motion.
Cypress.on('window:before:load', win => {
  win.addEventListener('DOMContentLoaded', () => {
    const style = win.document.createElement('style');
    style.textContent = '.fade-in { animation: none !important; }';
    win.document.head.appendChild(style);
  });
});
