import { hapticTap } from '../../lib/haptics';

export type TileVariant = 'bank' | 'placed' | 'selected' | 'locked' | 'muted';

const VARIANTS: Record<TileVariant, string> = {
  bank: 'border-slate-200 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100',
  placed:
    'border-accent-300 bg-accent-50 text-accent-800 dark:border-accent-700/60 dark:bg-accent-700/20 dark:text-accent-100',
  selected: 'border-accent-600 bg-accent-600 text-white dark:border-accent-500 dark:bg-accent-600',
  locked:
    'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200',
  muted:
    'border-slate-200 bg-slate-100 text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-600',
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
  className?: string;
  shake?: boolean;
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
  className = '',
  shake,
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
      className={`min-h-11 rounded-xl border px-3 py-2 text-[15px] font-medium shadow-sm transition-transform active:scale-[0.97] disabled:active:scale-100 ${
        VARIANTS[variant]
      } ${hidden ? 'pointer-events-none invisible' : ''} ${
        shake ? 'motion-safe:animate-shake' : ''
      } ${className}`}
    >
      {label}
    </button>
  );
}
