// Colour helpers for the group theme. Plain functions with no Angular in them, so they can be
// reasoned about and tested on their own.
//
// The spec makes the theme colour a group's one customisation, and says it extends into that
// group's chat rooms. That puts an admin-chosen colour behind real text, and a text colour
// fixed at build time cannot work for both a pale yellow and a navy. So the readable one is
// worked out from the colour itself, using the contrast formula WCAG defines.

export const DARK_INK = '#1A1D23';    // the palette's text colour, for light themes
export const LIGHT_INK = '#FFFFFF';   // for dark themes

// '#5FA8D3' or the short '#5AD' form -> [r, g, b] in 0-255, or null if it isn't a hex colour.
// The colour comes out of a <input type="color"> so it should always be the long form, but it
// is read back from the database and nothing stops a bad value being written there directly.
function parseHex(hex: string): [number, number, number] | null {
  const value = (hex ?? '').trim().replace(/^#/, '');
  const full = value.length === 3 ? value.split('').map(c => c + c).join('') : value;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

// WCAG relative luminance: how bright a colour actually looks, 0 for black and 1 for white.
// Each channel is un-gamma-corrected first, because sRGB values are not linear - #808080 is
// nowhere near half as bright as #FFFFFF, to the eye or to this formula. The three weights are
// the green-heavy ones from the spec, because the eye is most sensitive to green.
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

// WCAG contrast ratio between two colours: 1 when they are identical, 21 for black on white.
// AA wants 4.5 for body text and 3 for large text. The 0.05 on both sides stops a pure black
// background dividing by zero, and models the light a real screen reflects.
export function contrastRatio(a: string, b: string): number {
  const first = parseHex(a);
  const second = parseHex(b);
  if (!first || !second) return 1;      // unknown, so claim the worst rather than a false pass
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

// The more readable of the two ink colours on the given background. Comparing the two real
// contrast ratios rather than testing luminance against a 0.5 midpoint, because the midpoint
// is only ever an approximation of this and gets the awkward middle greens and blues wrong.
export function readableInk(theme: string): string {
  if (!parseHex(theme)) return DARK_INK;    // same assumption the rest of the app already makes
  return contrastRatio(theme, LIGHT_INK) > contrastRatio(theme, DARK_INK) ? LIGHT_INK : DARK_INK;
}
