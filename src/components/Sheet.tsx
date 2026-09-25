import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** id of the element (usually the title) this sheet is labelled by, for aria-labelledby. */
  titleId: string;
  children: ReactNode;
}

/**
 * Open sheets, oldest first. A sheet can open another one (the course switcher opens the
 * import problems sheet), and Escape must close only the topmost layer.
 */
const openStack: object[] = [];

/**
 * Bottom sheet used for the "coming soon" notice and confirm dialogs. Rendered into
 * `document.body` so a sheet opened from inside another one is a sibling layer, not a
 * dialog nested in a dialog.
 */
export function Sheet({ open, onClose, titleId, children }: SheetProps) {
  useEffect(() => {
    if (!open) return;
    const token = {};
    openStack.push(token);
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && openStack[openStack.length - 1] === token) onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const index = openStack.indexOf(token);
      if (index !== -1) openStack.splice(index, 1);
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        // p-5 plus the bottom safe-area inset on top, so the sheet's own
        // padding-bottom isn't just replaced by the inset (which is 0 on most
        // non-notched devices).
        className="w-full max-w-[480px] rounded-t-2xl bg-sheet p-5 pb-[calc(var(--spacing)*5+env(safe-area-inset-bottom))] shadow-xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
