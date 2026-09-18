import { useId } from 'react';
import { Sheet } from './Sheet';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  return (
    <Sheet open={open} onClose={onCancel} titleId={titleId}>
      <h2 id={titleId} className="text-lg font-semibold text-slate-900 dark:text-slate-50">
        {title}
      </h2>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{body}</p>
      <div className="mt-5 flex gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 flex-1 rounded-xl border border-slate-300 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className={`min-h-11 flex-1 rounded-xl text-sm font-semibold text-white ${
            danger ? 'bg-red-600' : 'bg-accent-600'
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </Sheet>
  );
}
