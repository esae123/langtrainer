/** Very short vibration on tap, where the browser supports it. */
export function hapticTap(): void {
  if (typeof navigator === 'undefined') return;
  if (typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(10);
  } catch {
    // Some browsers throw when the document is not focused; a missing buzz is fine.
  }
}
