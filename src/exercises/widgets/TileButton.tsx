import { hapticTap } from '../../lib/haptics';

export type TileVariant = 'bank' | 'placed' | 'selected';

const VARIANTS: Record<TileVariant, string> = {
  bank: 'border-line bg-sheet text-text',
  placed: 'border-line bg-accent-soft text-text',
  // Selected: accent border over a faint accent wash (docs/stage-3b-spec.md §6).
  selected: 'border-accent bg-accent-soft text-text ring-1 ring-accent',
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
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-bold tabular-nums text-accent-ink"
        >
          {badge}
        </span>
      )}
      <span className="min-w-0">{label}</span>
    </button>
  );
}
