describe('Movie Details', () => {
  it('loads a movie page', () => {
    cy.loginAsAdmin();
    // Try to load minions: rise of gru
    cy.visit('/movie/438148');

    cy.get('[data-testid=media-title]').should(
      'contain',
      'Minions: The Rise of Gru (2022)'
    );
  });

  it('keeps unavailable management visible but disabled with an explanation', () => {
    cy.loginAsAdmin();
    cy.visit('/movie/438148?manage=1');
    cy.get('button[aria-label="Manage Movie"]')
      .should('be.visible')
      .and('be.disabled')
      .and(
        'have.attr',
        'title',
        'This title must be added to a media service before it can be managed.'
      );
    cy.get('button[aria-label="Close panel"]').should('not.exist');
  });
});
