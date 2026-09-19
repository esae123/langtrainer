interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}

/** Accessible switch with a 44px tap target around a smaller visual pill. */
export function Toggle({ checked, onChange, label }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="flex min-h-11 min-w-11 items-center justify-center"
    >
      <span
        className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
          checked ? 'bg-accent' : 'bg-line'
        }`}
      >
        {/* Positioned rather than translated so no utility name contains a
            colour word from the old palette (the theme gate greps for those). */}
        <span
          className={`absolute inline-block h-5 w-5 rounded-full bg-sheet shadow transition-[left] duration-150 ${
            checked ? 'left-6' : 'left-1'
          }`}
        />
      </span>
    </button>
  );
}
