describe('TV Details', () => {
  it('loads a tv details page', () => {
    cy.loginAsAdmin();
    // Try to load stranger things
    cy.visit('/tv/66732');

    cy.get('[data-testid=media-title]').should(
      'contain',
      'Stranger Things (2016)'
    );
  });

  it('shows standard and 4K requests as adjacent individual buttons', () => {
    cy.loginAsAdmin();
    cy.intercept('GET', '/api/v1/settings/public', (request) => {
      request.continue((response) => {
        response.body.series4kEnabled = true;
      });
    });
    cy.visit('/tv/66732');

    cy.get('[data-testid=request-action-request]').should('be.visible');
    cy.get('[data-testid=request-action-request4k]')
      .should('be.visible')
      .then(($fourKButton) => {
        cy.get('[data-testid=request-action-request]').then(
          ($standardButton) => {
            expect(
              $fourKButton[0].getBoundingClientRect().left
            ).to.be.greaterThan(
              $standardButton[0].getBoundingClientRect().left
            );
          }
        );
      });
  });

  it('shows seasons and expands episodes', () => {
    cy.loginAsAdmin();

    // Try to load stranger things
    cy.visit('/tv/66732');

    // intercept request for season info
    cy.intercept('/api/v1/tv/66732/season/4').as('season4');

    cy.contains('Season 4').should('be.visible').scrollIntoView().click();

    cy.wait('@season4');

    cy.contains('Chapter Nine').should('be.visible');
  });
});
