import type { ReactNode } from 'react';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

/** Bottom sheet used for the "coming soon" notice and confirm dialogs. */
export function Sheet({ open, onClose, children }: SheetProps) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="safe-bottom w-full max-w-[480px] rounded-t-2xl bg-white p-5 shadow-xl dark:bg-slate-900"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {children}
      </div>
    </div>
  );
}
