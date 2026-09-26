import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  DEFAULT_THEME_PALETTE_ID,
  getThemeTokens,
  themePalettes,
} from './ThemeContext';

describe('themePalettes', () => {
  it('uses the Blackout chrome for SeerrNG without a duplicate palette', () => {
    assert.equal(
      themePalettes.find((palette) => palette.id === 'blackout'),
      undefined
    );
    assert.deepEqual(
      themePalettes.slice(0, 2).map((palette) => palette.name),
      ['SeerrNG', 'Seerr']
    );
    for (const mode of ['dark', 'light'] as const) {
      const seerrng = getThemeTokens(mode, 'seerr');
      assert.equal(seerrng.chrome, 'blackout');
      assert.equal(seerrng.searchbarScrolled, '0 0 0');
      assert.equal(seerrng.sidebarStart, '0 0 0');
      assert.equal(seerrng.sidebarEnd, '0 0 0');
    }
  });

  it('keeps overlay opacity at its shared owner and scopes black to SeerrNG', () => {
    const css = readFileSync('src/styles/globals.css', 'utf8');
    const block = css.match(
      /\[data-theme-palette='seerr'\] \{([^}]+)\}/
    )?.[1];
    assert.ok(block);
    assert.doesNotMatch(block, /--color-|--theme-control-(text|border):/);
    for (const [token, value] of Object.entries({
      'gradient-light': '0 0 0',
      'gradient-main': '40 68 120',
      'gradient-deep': '14 28 58',
      'gradient-black': '0 0 0',
    })) {
      assert.ok(block.includes(`--theme-page-${token}: ${value};`));
    }
    for (const token of ['light', 'main', 'deep', 'neutral', 'menu']) {
      assert.ok(block.includes(`--theme-overlay-${token}: 0 0 0;`));
    }
    for (const [selector, opacity] of [
      ['refreshed-card-surface', '0.38'],
      ['refreshed-inset-surface', '0.42'],
      ['refreshed-artwork-scrim', '0.46'],
      ['settings-main-card', '0.38'],
      ['app-searchbar-scrolled', '0.8'],
    ]) {
      const rule = css.split(`.${selector} {`)[1]?.split('}')[0];
      assert.ok(rule?.includes(`/ ${opacity})`), selector);
    }
    const sidebar = css.match(
      /\[data-theme-palette='seerr'\] \.sidebar \{([^}]+)\}/
    )?.[1];
    assert.ok(sidebar);
    assert.ok(sidebar?.includes('radial-gradient('));
    assert.ok(sidebar?.includes('linear-gradient('));
    assert.ok(sidebar?.includes('rgb(var(--theme-page-gradient-main) / 0.8)'));
    assert.ok(sidebar?.includes('backdrop-filter: blur(5px)'));
    const seerrng = getThemeTokens('dark', 'seerr');
    for (const shade of [500, 600, 800]) {
      assert.ok(
        sidebar.includes(
          `--color-indigo-${shade}: ${seerrng.primaryScale[shade / 100]};`
        )
      );
      assert.ok(
        sidebar.includes(
          `--color-purple-${shade}: ${seerrng.secondaryScale[shade / 100]};`
        )
      );
    }
  });

  it('uses SeerrNG as the default palette', () => {
    assert.equal(DEFAULT_THEME_PALETTE_ID, 'seerr');
    assert.equal(themePalettes[0].id, DEFAULT_THEME_PALETTE_ID);
    assert.equal(themePalettes[0].name, 'SeerrNG');
  });

  it('preserves the classic Seerr dark chrome as an alternative', () => {
    const tokens = getThemeTokens('dark', 'classic');

    assert.equal(tokens.pageBg, '17 24 39');
    assert.equal(tokens.pageGlowStart, '31 41 55');
    assert.equal(tokens.searchbarScrolled, '55 65 81');
    assert.equal(tokens.sidebarStart, '31 41 55');
    assert.equal(tokens.sidebarEnd, '19 25 40');
    assert.equal(tokens.sidebarBorder, '55 65 81');
    assert.equal(tokens.sidebarHover, '55 65 81');
    assert.equal(tokens.primaryScale[6], '79 70 229');
    assert.equal(tokens.secondaryScale[6], '147 51 234');
  });

  it('exposes SeerrNG with the Blackout chrome and shared scales', () => {
    const seerr = themePalettes.find((palette) => palette.id === 'seerr');
    assert.deepStrictEqual(seerr, {
      id: 'seerr',
      name: 'SeerrNG',
      surface: 'gray',
      primary: 'indigo',
      secondary: 'purple',
      chrome: 'blackout',
    });
    assert.notEqual(
      getThemeTokens('dark', 'seerr').pageBg,
      getThemeTokens('dark', 'classic').pageBg
    );
  });

  it('includes the Sietch palette displayed by the theme picker', () => {
    assert.deepEqual(themePalettes.map((palette) => palette.id).slice(-3), [
      'violet',
      'ocean',
      'sietch-neon',
    ]);

    assert.equal(
      themePalettes.find((palette) => palette.id === 'sietch-neon')?.name,
      'Sietch'
    );

    assert.deepEqual(
      themePalettes.find((palette) => palette.id === 'sietch-neon'),
      {
        id: 'sietch-neon',
        name: 'Sietch',
        swatchCount: 4,
        surface: 'sietchSpice',
        primary: 'sietchSpice',
        secondary: 'sietchNeon',
      }
    );
  });

  it('gives every palette distinct page and sidebar chrome in both modes', () => {
    for (const mode of ['dark', 'light'] as const) {
      const chromeSignatures = themePalettes.map((palette) => {
        const tokens = getThemeTokens(mode, palette.id);

        return [
          tokens.pageBg,
          tokens.pageGlowStart,
          tokens.pageGlowEnd,
          tokens.searchbarScrolled,
          tokens.sidebarStart,
          tokens.sidebarEnd,
        ].join('|');
      });

      assert.equal(
        new Set(chromeSignatures).size,
        themePalettes.length,
        `${mode} theme chrome should be unique per palette`
      );
    }
  });

  it('keeps Sietch spice-led with neon as the secondary accent', () => {
    const darkTokens = getThemeTokens('dark', 'sietch-neon');
    const [pageRed, pageGreen, pageBlue] = darkTokens.pageBg
      .split(' ')
      .map(Number);
    const [accentRed, accentGreen, accentBlue] = darkTokens.sidebarBorder
      .split(' ')
      .map(Number);

    assert.ok(pageRed >= pageBlue, 'Sietch page background should stay warm');
    assert.ok(
      pageGreen >= pageBlue,
      'Sietch page background should stay brown'
    );
    assert.ok(
      accentBlue > accentRed && accentBlue > accentGreen,
      'Sietch secondary accents should stay neon purple'
    );
  });
});
