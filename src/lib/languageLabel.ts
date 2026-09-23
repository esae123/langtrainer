/**
 * A human-readable name for a BCP-47 language tag ("pt-PT" → "European Portuguese"),
 * in the given UI language. Falls back to the tag itself where `Intl.DisplayNames`
 * is unavailable or doesn't know the tag.
 */
export function languageLabel(tag: string, uiLanguage: string): string {
  try {
    const names = new Intl.DisplayNames([uiLanguage], { type: 'language' });
    return names.of(tag) ?? tag;
  } catch {
    return tag;
  }
}
