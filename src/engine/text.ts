// Answer text normalisation (docs/stage-3-spec.md §3).

// Leading/trailing punctuation around a single token: full stops, commas, bangs,
// question marks (also inverted ¿ ¡), semicolons, colons, ellipsis dots, guillemets,
// quotes (also low „ ‚), brackets, hyphens and em/en dashes — but only at the very edge
// of the token. A hyphen or apostrophe between two letters (chama-se, d'água) is never at
// the edge of its own token, so it survives.
const EDGE_PUNCTUATION = /^[.,!?;:…«»"“”„'’‘‚()[\]¿¡—–-]+|[.,!?;:…«»"“”„'’‘‚()[\]¿¡—–-]+$/gu;

/** The trailing wrapper characters (closing quotes/guillemets/brackets) before a final mark. */
const TRAILING_WRAP = /[»”’'"\])]+$/u;
/** One sentence-final mark: a run of `.`, `!`, `?` or the ellipsis character. */
const FINAL_MARK = /[.!?…]+$/u;

/** Strips leading/trailing punctuation from one token, keeping word-internal hyphens/apostrophes. */
export function stripTokenPunctuation(token: string): string {
  return token.replace(EDGE_PUNCTUATION, '');
}

/**
 * Strips ALL punctuation from a piece of text, word by word, keeping word-internal
 * hyphens and apostrophes (chama-se, d'água). Mid-sentence punctuation (a comma after a
 * word, a question mark at the end) is removed exactly like edge punctuation on a single
 * token, because every punctuation mark in a sentence sits at the edge of some word.
 */
export function stripPunctuation(value: string): string {
  return value.split(/\s+/u).filter(Boolean).map(stripTokenPunctuation).filter(Boolean).join(' ');
}

/**
 * The expected sentence's final punctuation mark (`.`, `?`, `!` or `…`), ignoring any
 * trailing quotes/guillemets — or `null` when the sentence does not end on one. Used to
 * show the mark next to a tile answer line without putting it on a tile.
 */
export function finalPunctuationMark(value: string): string | null {
  const trimmed = value.trim().replace(TRAILING_WRAP, '');
  const match = trimmed.match(FINAL_MARK);
  return match ? match[0] : null;
}

/**
 * Trim, collapse whitespace, lowercase and drop ALL punctuation except word-internal
 * hyphens and apostrophes — so a missing/extra comma, a missing final `?` or guillemets
 * never change the result.
 */
export function normalize(value: string): string {
  return stripPunctuation(value).toLowerCase();
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
