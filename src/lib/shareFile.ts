// Handing a generated JSON file to the OS: Web Share API on a phone, a download link
// everywhere else. Shared by the backup export and the course-file export.

type ShareCapableNavigator = Navigator & {
  canShare?: (data?: ShareData) => boolean;
  share?: (data: ShareData) => Promise<void>;
};

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled';

/**
 * Shares `text` as `filename`, falling back to a download. Returns `'cancelled'` when
 * the user dismisses the share sheet, so callers can skip their success toast.
 */
export async function shareOrDownloadFile(
  text: string,
  filename: string,
  type = 'application/json'
): Promise<ShareOutcome> {
  const file = new File([text], filename, { type });

  const nav = navigator as ShareCapableNavigator;
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: filename });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return 'cancelled';
      throw err;
    }
    return 'shared';
  }

  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Some browsers (notably older Safari) need the URL to stay valid slightly
  // past the synchronous click; revoking on the next tick is safe everywhere.
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return 'downloaded';
}
