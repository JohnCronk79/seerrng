const liveAudit = Cypress.expose('RUN_LIVE_AUTH_AUDIT') === true;

const routes = [
  '/',
  '/discover/trending',
  '/discover/movies',
  '/discover/movies/upcoming',
  '/discover/movies/genres',
  '/discover/tv',
  '/discover/tv/upcoming',
  '/discover/tv/genres',
  '/discover/music',
  '/discover/books',
  '/discover/watchlist',
  '/requests',
  '/issues',
  '/blocklist',
  '/users',
  '/profile',
  '/profile/watchlist',
  '/profile/settings/main',
  '/profile/settings/password',
  '/profile/settings/linked-accounts',
  '/profile/settings/permissions',
  '/settings/main',
  '/settings/plex',
  '/settings/jellyfin',
  '/settings/services',
  '/settings/users',
  '/settings/network',
  '/settings/metadata',
  '/settings/jobs',
  '/settings/logs',
  '/settings/about',
] as const;

(liveAudit ? describe : describe.skip)('Live authenticated smoke audit', () => {
  beforeEach(() => {
    cy.env<{ LIVE_QA_EMAIL: string; LIVE_QA_PASSWORD: string }>([
      'LIVE_QA_EMAIL',
      'LIVE_QA_PASSWORD',
    ]).then(({ LIVE_QA_EMAIL, LIVE_QA_PASSWORD }) => {
      cy.login(LIVE_QA_EMAIL, LIVE_QA_PASSWORD);
    });
  });

  routes.forEach((route) => {
    it(`loads ${route} without server or browser errors`, () => {
      const browserErrors: string[] = [];
      const serverErrors: string[] = [];
      const startedAt = Date.now();

      cy.on('window:before:load', (win) => {
        cy.stub(win.console, 'error').callsFake((...args) => {
          browserErrors.push(args.map(String).join(' '));
        });
      });
      cy.intercept('/api/v1/**', (req) => {
        req.on('response', (res) => {
          if (res.statusCode >= 500) {
            serverErrors.push(`${res.statusCode} ${req.method} ${req.url}`);
          }
        });
      });

      cy.visit(route);
      cy.get('#__next').should('be.visible').and('not.be.empty');
      cy.location('pathname').should('not.eq', '/login');
      cy.then(() => {
        expect(Date.now() - startedAt, `${route} load time`).to.be.lessThan(
          10_000
        );
        expect(browserErrors, `${route} browser errors`).to.deep.equal([]);
        expect(serverErrors, `${route} API 5xx responses`).to.deep.equal([]);
      });
    });
  });

  it('executes search and follows a result link', () => {
    cy.visit('/search?query=Star%20Wars');
    cy.contains('Star Wars', { timeout: 10_000 })
      .should('be.visible')
      .closest('[data-testid="title-card"]')
      .find('a[href]')
      .first()
      .should('have.attr', 'href')
      .then((href) => {
        expect(href).to.match(/^\/(movie|tv|music|book)\//);
        cy.visit(String(href));
        cy.location('pathname').should('eq', String(href).split('?')[0]);
        cy.get('#__next').should('be.visible').and('not.be.empty');
      });
  });
});
