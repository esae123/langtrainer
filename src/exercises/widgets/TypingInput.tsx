import { useEffect, useRef } from 'react';
import { AccentBar } from './AccentBar';
import { insertAtCaret } from './accents';

interface TypingInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Called when the learner presses Enter in a single-line input. */
  onSubmit?: () => void;
  multiline?: boolean;
  label: string;
  placeholder?: string;
  /** Renders a compact field (used for inline gaps). */
  compact?: boolean;
  autoFocus?: boolean;
}

/**
 * Text entry with an accent bar. Autocapitalise/autocorrect are off and the field is
 * tagged `lang="pt-PT"` so the keyboard suggests the target language.
 */
export function TypingInput({
  value,
  onChange,
  onSubmit,
  multiline,
  label,
  placeholder,
  compact,
  autoFocus,
}: TypingInputProps) {
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const caretRef = useRef<number | null>(null);

  // Restore the caret after an accent-bar insertion (the value round-trips via props).
  useEffect(() => {
    const el = ref.current;
    if (!el || caretRef.current === null) return;
    const caret = Math.min(caretRef.current, el.value.length);
    caretRef.current = null;
    el.setSelectionRange(caret, caret);
  }, [value]);

  function insert(char: string) {
    const el = ref.current;
    const next = insertAtCaret(el, value, char);
    onChange(next.value);
    caretRef.current = next.caret;
    el?.focus();
  }

  const shared = {
    value,
    lang: 'pt-PT',
    autoCapitalize: 'off' as const,
    autoCorrect: 'off',
    autoComplete: 'off',
    spellCheck: false,
    placeholder,
    'aria-label': label,
    onChange: (event: { target: { value: string } }) => onChange(event.target.value),
    className: `w-full rounded-xl border border-slate-300 bg-white px-3 text-[17px] text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-accent-500 focus:ring-2 focus:ring-accent-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 dark:focus:ring-accent-700/40 ${
      compact ? 'min-h-11 py-2' : 'min-h-12 py-3'
    }`,
  };

  return (
    <div className="flex flex-col gap-2">
      {multiline ? (
        <textarea
          {...shared}
          ref={ref as React.Ref<HTMLTextAreaElement>}
          rows={3}
          autoFocus={autoFocus}
        />
      ) : (
        <input
          {...shared}
          ref={ref as React.Ref<HTMLInputElement>}
          type="text"
          autoFocus={autoFocus}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && onSubmit) {
              event.preventDefault();
              onSubmit();
            }
          }}
        />
      )}

      <AccentBar onInsert={insert} />
    </div>
  );
}
