/** Short, locale-aware date ("12 Mar 2026"), used for backups and review dates. */
export function formatDate(ms: number, locale: string): string {
  return new Date(ms).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Short, locale-aware date and time ("12 Mar 2026, 18:05"), used for the session list. */
export function formatDateTime(ms: number, locale: string): string {
  return new Date(ms).toLocaleString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
