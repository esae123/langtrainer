import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ToastApiContext, type ShowToast } from './toastStore';

interface ToastState {
  id: number;
  message: string;
}

const TOAST_DURATION_MS = 3000;

/** Single-slot toast host; mount once near the app root. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timeoutRef = useRef<number | null>(null);

  const show = useCallback<ShowToast>((message) => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    const id = Date.now();
    setToast({ id, message });
    timeoutRef.current = window.setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current));
    }, TOAST_DURATION_MS);
  }, []);

  return (
    <ToastApiContext.Provider value={show}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4"
      >
        {toast && (
          <div className="pointer-events-auto rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-lg dark:bg-slate-100 dark:text-slate-900">
            {toast.message}
          </div>
        )}
      </div>
    </ToastApiContext.Provider>
  );
}
