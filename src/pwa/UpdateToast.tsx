import { useRegisterSW } from 'virtual:pwa-register/react';
import { useT } from '../i18n';

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** Shows a toast with an "Update" action whenever a new service worker is waiting. */
export function UpdateToast() {
  const t = useT();
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      window.setInterval(() => void registration.update(), UPDATE_CHECK_INTERVAL_MS);
    },
  });

  if (!needRefresh) return null;

  return (
    <div className="fixed inset-x-0 bottom-20 z-50 flex justify-center px-4">
      <div className="flex items-center gap-3 rounded-xl bg-accent-600 px-4 py-3 text-sm text-white shadow-lg">
        <span>{t('update.available')}</span>
        <button
          type="button"
          onClick={() => updateServiceWorker(true)}
          className="min-h-9 rounded-lg bg-white/20 px-3 font-semibold"
        >
          {t('update.update')}
        </button>
      </div>
    </div>
  );
}
