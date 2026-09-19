// Answer text normalisation (docs/stage-3-spec.md §3).

const EDGE_QUOTES = /^[«»"'“”‘’]+|[«»"'“”‘’]+$/g;
const EDGE_PUNCTUATION = /[.!?]+$/;

/**
 * Trim, collapse whitespace, lowercase, drop terminal `.`/`!`/`?` and surrounding
 * quotes or guillemets. Internal punctuation and hyphens are kept.
 */
export function normalize(value: string): string {
  let out = value.replace(/\s+/g, ' ').trim();
  for (;;) {
    const before = out;
    out = out.replace(EDGE_QUOTES, '').trim();
    out = out.replace(EDGE_PUNCTUATION, '').trim();
    if (out === before) break;
  }
  return out.toLowerCase();
}

/** Removes accents, tildes and cedillas: `não` -> `nao`, `português` -> `portugues`. */
export function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');
}

/** Normalised *and* accent-stripped, i.e. the loosest comparison form. */
export function normalizeStripped(value: string): string {
  return stripDiacritics(normalize(value));
}

/** Classic two-row Levenshtein distance. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[b.length];
}
