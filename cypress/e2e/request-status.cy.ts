describe('Request Status', () => {
  beforeEach(() => {
    cy.loginAsAdmin();
  });

  it('opens on all requests and lets users choose a history window', () => {
    cy.visit('/requests/status');

    cy.get('select[aria-label="Time Period"]')
      .should('be.visible')
      .and('have.value', 'all');

    cy.get('select[aria-label="Time Period"]').select('14d');
    cy.location('search').should('contain', 'timeFrame=14d');

    cy.get('select[aria-label="Time Period"]').select('all');
    cy.location('search').should('not.contain', 'timeFrame=');

    cy.contains('button', 'Books').should('be.visible');
    cy.contains('button', 'Audiobooks').click();
    cy.location('search').should('contain', 'mediaType=audiobook');
    cy.contains('Showing requests for').should('be.visible');
    cy.contains('Audiobook').should('be.visible');
  });
});
