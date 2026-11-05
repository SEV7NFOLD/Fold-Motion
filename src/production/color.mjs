/**
 * Color helpers shared by production planning, the repair layer and creative QA.
 * Contrast follows WCAG 2.x relative luminance, the same math creative QA uses.
 */

export const LIGHT_TEXT = '#F8FAFC';
export const DARK_TEXT = '#0B0F19';
export const MIN_TEXT_CONTRAST = 4.5;

export function hexRgb(color) {
  if (typeof color !== 'string' || !/^#[\da-f]{6}$/i.test(color)) return null;
  return [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(color.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
}

export function contrastRatio(first, second) {
  const a = hexRgb(first);
  const b = hexRgb(second);
  if (!a || !b) return null;
  const luminance = (rgb) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

/** The text color (light or dark) that reads best on the given background. */
export function readableTextColor(background) {
  const light = contrastRatio(LIGHT_TEXT, background) ?? 0;
  const dark = contrastRatio(DARK_TEXT, background) ?? 0;
  return light >= dark ? LIGHT_TEXT : DARK_TEXT;
}
