// Handing a generated JSON file to the OS: Web Share API on a phone, a download link
// everywhere else. Shared by the backup export and the course-file export.

// Web Share is typed as always-present in lib.dom, but it isn't implemented everywhere
// (desktop Chrome/Firefox, most browsers without a share target). Override rather than
// intersect so these members stay optional for feature-detection at runtime.
type ShareCapableNavigator = Omit<Navigator, 'canShare' | 'share'> & {
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
  // Chrome on Android only allows a handful of MIME types through the Web Share
  // Level 2 file-type allowlist, and application/json is not one of them — sharing
  // with that type makes nav.share reject even when canShare() returned true. The
  // importer reads file contents, not file.type, so text/plain is safe to share
  // under; the download fallback below still uses the caller's real `type`.
  const shareFile = new File([text], filename, { type: 'text/plain' });

  const nav = navigator as ShareCapableNavigator;
  const share = nav.share;
  let canShare: boolean;
  try {
    canShare =
      typeof share === 'function' && Boolean(nav.canShare?.({ files: [shareFile] }));
  } catch {
    canShare = false;
  }

  if (canShare && share) {
    try {
      await share({ files: [shareFile], title: filename });
      return 'shared';
    } catch (err) {
      // Duck-typed rather than `instanceof Error`: DOMException (what a real share
      // rejection is) doesn't reliably satisfy `instanceof Error` across environments.
      if ((err as { name?: unknown } | null)?.name === 'AbortError') return 'cancelled';
      // Any other failure (NotAllowedError from expired user activation, DataError,
      // TypeError, etc.) falls through to the download link instead of surfacing
      // "Backup failed" — the file is still safely on the device either way.
    }
  }

  // Not caught: if this also throws, "Backup failed" is the right outcome — there's
  // no further fallback to try.
  const downloadFile = new File([text], filename, { type });
  const url = URL.createObjectURL(downloadFile);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Android's download manager can pick the blob up well after the click returns,
  // especially in a standalone PWA; revoke after a delay instead of immediately.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return 'downloaded';
}
