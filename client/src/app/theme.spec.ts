import { contrastRatio, readableInk, DARK_INK, LIGHT_INK } from './theme';

// plain functions, no TestBed. real colours from the seed data and the app's fallback.
describe('theme', () => {
  it('gives the WCAG end points: 21 for black on white, 1 for a colour on itself', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#5FA8D3', '#5FA8D3')).toBe(1);
  });

  it('is the same whichever way round the two colours go', () => {
    expect(contrastRatio('#7B3FF2', LIGHT_INK)).toBe(contrastRatio(LIGHT_INK, '#7B3FF2'));
  });

  it('reads the short #abc form the same as the long one', () => {
    expect(contrastRatio('#5AD', '#FFF')).toBe(contrastRatio('#55AADD', '#FFFFFF'));
  });

  it('picks dark text on the light and middle themes', () => {
    // looks mid-blue, but dark text beats white on it easily
    expect(readableInk('#5FA8D3')).toBe(DARK_INK);
    expect(readableInk('#7FDBC4')).toBe(DARK_INK);
    expect(readableInk('#E8EDFB')).toBe(DARK_INK);
  });

  it('picks white text on a dark theme', () => {
    expect(readableInk('#7B3FF2')).toBe(LIGHT_INK);
    expect(readableInk('#000000')).toBe(LIGHT_INK);
  });

  it('every seeded theme now passes AA (4.5:1) with the ink it is given', () => {
    for (const theme of ['#5FA8D3', '#7FDBC4', '#7B3FF2', '#E8EDFB']) {
      expect(contrastRatio(theme, readableInk(theme))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('falls back safely on a value that isn\'t a colour', () => {
    expect(readableInk('not a colour')).toBe(DARK_INK);
    expect(readableInk('')).toBe(DARK_INK);
    expect(contrastRatio('nope', '#FFFFFF')).toBe(1);     // unknown assumes the worst
  });
});
