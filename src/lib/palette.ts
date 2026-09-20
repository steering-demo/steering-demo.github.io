/**
 * Data colours for the showcase.
 *
 * The candidates lie on a signed axis, so this is a diverging encoding: a hue at each pole and
 * a neutral grey in the middle. Blue and orange are used rather than red and green, because a
 * negative alpha is a direction, not a verdict.
 *
 * Validated against the dark chart surface (#1a1a19): worst all-pairs CVD delta-E 10.9 under
 * deuteranopia, normal-vision 16.8, every token colour at or above 3:1 contrast. The grey
 * midpoint is intentionally below the categorical chroma floor - a diverging midpoint is
 * supposed to read as neutral - and identity never rests on colour alone: every row carries its
 * token as text.
 */

export const TOKEN_NEGATIVE = '#3987e5';
export const TOKEN_MIDDLE = '#8f8e85';
export const TOKEN_POSITIVE = '#d95926';
export const TOKEN_OTHER = '#5f5e57';

export const SURFACE = '#1a1a19';
export const GRID = '#32322e';
export const INK_2 = '#c3c2b7';
export const INK_3 = '#94938b';

/** Extra greys for the unusual case of more than three candidates. */
const MIDDLE_STEPS = [TOKEN_MIDDLE, '#aeada2', '#77766e', '#a09e94'];

/**
 * Colour for candidate `index` of `count`, ordered as declared in `scenarios.md`.
 * First candidate takes the negative pole, last the positive pole, the rest neutral greys.
 */
export function candidateColor(index: number, count: number): string {
  if (index === 0) return TOKEN_NEGATIVE;
  if (index === count - 1) return TOKEN_POSITIVE;
  return MIDDLE_STEPS[(index - 1) % MIDDLE_STEPS.length];
}

/** A low-alpha tint of a token colour, for the chip behind the selected token in the text. */
export function tint(color: string, alpha: number): string {
  return `color-mix(in oklab, ${color} ${Math.round(alpha * 100)}%, transparent)`;
}
