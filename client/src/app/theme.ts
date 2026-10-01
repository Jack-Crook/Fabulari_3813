// colour helpers for group themes. an admin can pick any theme and text sits on it, so the
// readable text colour is worked out with the WCAG contrast formula.

export const DARK_INK = '#1A1D23';    // the palette's text colour, for light themes
export const LIGHT_INK = '#FFFFFF';   // for dark themes

// '#5FA8D3' or '#5AD' -> [r, g, b] 0-255, or null if it isn't a hex colour
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

// WCAG relative luminance, 0 (black) to 1 (white). channels are linearised first since sRGB
// isn't linear, and green is weighted most because the eye is most sensitive to it.
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

// WCAG contrast ratio: 1 (same colour) to 21 (black on white). AA needs 4.5 for normal text.
// the 0.05 avoids dividing by zero on pure black.
export function contrastRatio(a: string, b: string): number {
  const first = parseHex(a);
  const second = parseHex(b);
  if (!first || !second) return 1;      // unknown, so assume the worst
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

// dark or white text, whichever has more contrast on the theme
export function readableInk(theme: string): string {
  if (!parseHex(theme)) return DARK_INK;    // fallback for a bad value
  return contrastRatio(theme, LIGHT_INK) > contrastRatio(theme, DARK_INK) ? LIGHT_INK : DARK_INK;
}
