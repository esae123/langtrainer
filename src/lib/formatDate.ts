/** Short, locale-aware date ("12 Mar 2026"), used for backups and review dates. */
export function formatDate(ms: number, locale: string): string {
  return new Date(ms).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
