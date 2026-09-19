import { hapticTap } from '../../lib/haptics';

export type TileVariant = 'bank' | 'placed' | 'selected';

const VARIANTS: Record<TileVariant, string> = {
  bank: 'border-slate-200 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100',
  placed:
    'border-accent-300 bg-accent-50 text-accent-800 dark:border-accent-700/60 dark:bg-accent-700/20 dark:text-accent-100',
  selected: 'border-accent-600 bg-accent-600 text-white dark:border-accent-500 dark:bg-accent-600',
};

interface TileButtonProps {
  label: string;
  onClick?: () => void;
  variant?: TileVariant;
  disabled?: boolean;
  ariaLabel?: string;
  ariaPressed?: boolean;
  /** Keeps the tile's footprint but hides it, so the bank never reflows. */
  hidden?: boolean;
  /** Small number shown on the tile; match_pairs uses it to link the two columns. */
  badge?: number;
  className?: string;
}

/** The one tile look shared by every tile-based exercise. Always ≥ 44px tall. */
export function TileButton({
  label,
  onClick,
  variant = 'bank',
  disabled,
  ariaLabel,
  ariaPressed,
  hidden,
  badge,
  className = '',
}: TileButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || hidden}
      aria-hidden={hidden || undefined}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      onClick={() => {
        hapticTap();
        onClick?.();
      }}
      className={`flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-[15px] font-medium shadow-sm transition-transform active:scale-[0.97] disabled:active:scale-100 ${
        VARIANTS[variant]
      } ${hidden ? 'pointer-events-none invisible' : ''} ${className}`}
    >
      {badge !== undefined && (
        <span
          aria-hidden
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-600 text-[11px] font-bold tabular-nums text-white"
        >
          {badge}
        </span>
      )}
      <span className="min-w-0">{label}</span>
    </button>
  );
}
