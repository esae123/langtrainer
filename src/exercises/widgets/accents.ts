/** European Portuguese characters that are awkward to reach on a default keyboard. */
export const ACCENT_KEYS = ['á', 'à', 'â', 'ã', 'é', 'ê', 'í', 'ó', 'ô', 'õ', 'ú', 'ç'];

/** Inserts `char` at the caret of a text field and returns the new value + caret. */
export function insertAtCaret(
  el: HTMLInputElement | HTMLTextAreaElement | null,
  value: string,
  char: string
): { value: string; caret: number } {
  const start = el?.selectionStart ?? value.length;
  const end = el?.selectionEnd ?? start;
  return { value: value.slice(0, start) + char + value.slice(end), caret: start + char.length };
}
