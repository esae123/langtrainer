import { stripTokenPunctuation } from '../../engine/text';

export interface Tile {
  id: string;
  label: string;
}

/**
 * Builds stable tile ids so duplicate labels stay distinguishable, and strips
 * leading/trailing punctuation from the displayed label (so a tile like "trabalhas?"
 * never gives away that it is the last word of a question) — word-internal hyphens and
 * apostrophes (chama-se, d'água) are kept. The id is derived from the original token, so
 * two tokens that only differ by punctuation still get distinct tiles.
 */
export function toTiles(labels: string[]): Tile[] {
  return labels.map((label, i) => ({ id: `${i}-${label}`, label: stripTokenPunctuation(label) }));
}
