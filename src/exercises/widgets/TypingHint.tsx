import { hintLetterCount, typingHintWords } from '../../engine/hint';
import { useT } from '../../i18n';
import { useSettings } from '../../settings/settingsStore';

/**
 * "s _ _ _ _  (5 letters)" under the prompt in typing mode (docs/stage-3b-spec.md §3).
 * Renders nothing when the hint is switched off or the answer is too long to hint at.
 */
export function TypingHint({
  expected,
  className = '',
}: {
  expected: string | null;
  className?: string;
}) {
  const t = useT();
  const { typingHint } = useSettings();
  const words = typingHint && expected ? typingHintWords(expected) : null;
  if (!words) return null;

  return (
    <p
      className={`text-[15px] font-medium tracking-[0.12em] text-slate-500 dark:text-slate-400 ${className}`}
    >
      <span>{words.map((word) => word.skeleton).join('   ')}</span>{' '}
      <span className="text-xs tracking-normal">
        {t('session.hintLetters', { count: hintLetterCount(words) })}
      </span>
    </p>
  );
}
