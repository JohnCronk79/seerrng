import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_THEME_PALETTE_ID,
  getThemeTokens,
  themePalettes,
} from './ThemeContext';

describe('themePalettes', () => {
  it('uses the Seerr palette as the default', () => {
    assert.equal(DEFAULT_THEME_PALETTE_ID, 'classic');
    assert.equal(themePalettes[0].id, DEFAULT_THEME_PALETTE_ID);
    assert.equal(themePalettes[0].name, 'Seerr');
  });

  it('preserves the Seerr dark chrome in the default palette', () => {
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

  it('exposes a distinct Seerr-branded blue palette', () => {
    const seerr = themePalettes.find((palette) => palette.id === 'seerr');

    assert.deepStrictEqual(seerr, {
      id: 'seerr',
      name: 'SeerrNG',
      swatches: ['#0f172a', '#2563eb', '#38bdf8'],
      surface: 'slate',
      primary: 'blue',
      secondary: 'sky',
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
        swatches: ['#8e6036', '#43352e', '#8f5cff', '#d7ff3f'],
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
