import { useT } from '../../i18n';
import { hapticTap } from '../../lib/haptics';
import { ACCENT_KEYS } from './accents';

/** Horizontal row of accent keys; `onInsert` receives the tapped character. */
export function AccentBar({ onInsert }: { onInsert: (char: string) => void }) {
  const t = useT();
  return (
    <div
      role="group"
      aria-label={t('session.accentBar')}
      className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1"
    >
      {ACCENT_KEYS.map((char) => (
        <button
          key={char}
          type="button"
          aria-label={t('session.insertAccent', { char })}
          // Keep the caret in the field: don't let the button take focus.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            hapticTap();
            onInsert(char);
          }}
          className="min-h-11 min-w-11 shrink-0 rounded-xl border border-slate-200 bg-white text-[17px] font-medium text-slate-700 shadow-sm transition-transform active:scale-[0.97] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        >
          {char}
        </button>
      ))}
    </div>
  );
}
