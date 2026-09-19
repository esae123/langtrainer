import { hapticTap } from '../../lib/haptics';

interface OptionListProps {
  options: string[];
  value: string | null;
  onChange: (value: string) => void;
  label: string;
  /** Defaults to a 2-column grid for four short options, a list otherwise. */
  columns?: 1 | 2;
}

/** Single-select list of 44px buttons (tiles mode for option-based exercises). */
export function OptionList({ options, value, onChange, label, columns }: OptionListProps) {
  const useTwoColumns =
    columns === 2 ||
    (columns === undefined && options.length % 2 === 0 && options.every((o) => o.length <= 14));

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={useTwoColumns ? 'grid grid-cols-2 gap-2' : 'flex flex-col gap-2'}
    >
      {options.map((option) => {
        const selected = option === value;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => {
              hapticTap();
              onChange(option);
            }}
            className={`flex min-h-12 items-center justify-center rounded-xl border px-3 py-2 text-center text-[15px] font-medium shadow-sm transition-transform active:scale-[0.98] ${
              selected
                ? 'border-accent-600 bg-accent-600 text-white'
                : 'border-slate-200 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100'
            }`}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}
