import './commands';

before(() => {
  if (Cypress.expose('SEED_DATABASE') === true) {
    cy.task('seedDatabase');
  }
});
