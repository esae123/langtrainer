export interface Tile {
  id: string;
  label: string;
}

/** Builds stable tile ids so duplicate labels stay distinguishable. */
export function toTiles(labels: string[]): Tile[] {
  return labels.map((label, i) => ({ id: `${i}-${label}`, label }));
}
