import { useEffect, type ReactNode } from 'react';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** id of the element (usually the title) this sheet is labelled by, for aria-labelledby. */
  titleId: string;
  children: ReactNode;
}

/** Bottom sheet used for the "coming soon" notice and confirm dialogs. */
export function Sheet({ open, onClose, titleId, children }: SheetProps) {
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        // p-5 plus the bottom safe-area inset on top, so the sheet's own
        // padding-bottom isn't just replaced by the inset (which is 0 on most
        // non-notched devices).
        className="w-full max-w-[480px] rounded-t-2xl bg-white p-5 pb-[calc(var(--spacing)*5+env(safe-area-inset-bottom))] shadow-xl dark:bg-slate-900"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        {children}
      </div>
    </div>
  );
}
