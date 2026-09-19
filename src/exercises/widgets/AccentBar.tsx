import { useT } from '../../i18n';
import { hapticTap } from '../../lib/haptics';
import { ACCENT_KEYS } from './accents';

/**
 * Accent keys as a helper strip under the answer field (docs/stage-3b-spec.md §2):
 * two rows of six on a narrow phone, one row of twelve from 480px up, so it always
 * fits the viewport without horizontal scrolling. Deliberately subdued.
 */
export function AccentBar({ onInsert }: { onInsert: (char: string) => void }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[11px] font-medium text-muted">{t('session.accentBarCaption')}</p>
      <div
        role="group"
        aria-label={t('session.accentBar')}
        className="grid grid-cols-6 gap-1 min-[480px]:grid-cols-12"
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
            className="min-h-10 rounded-lg border border-line bg-sheet text-[15px] font-medium text-muted transition-transform active:scale-[0.97]"
          >
            {char}
          </button>
        ))}
      </div>
    </div>
  );
}
