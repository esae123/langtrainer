import { useEffect, useMemo, useState } from 'react';
import type { OrderDialogueExercise } from '../content/types';
import { mulberry32, shuffle } from '../engine/rng';
import { useT } from '../i18n';
import { hapticTap } from '../lib/haptics';
import type { ExerciseViewProps } from './types';

function SpeakerBadge({ speaker }: { speaker: 'A' | 'B' }) {
  return (
    <span
      aria-hidden
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
        speaker === 'A' ? 'bg-accent-soft text-accent' : 'bg-ok-bg text-ok'
      }`}
    >
      {speaker}
    </span>
  );
}

/** order_dialogue: place the shuffled lines into numbered slots. */
export function OrderDialogueView({
  exercise,
  seed,
  onChange,
}: ExerciseViewProps<OrderDialogueExercise>) {
  const t = useT();
  const shuffled = useMemo(
    () =>
      shuffle(
        exercise.lines.map((_, i) => i),
        mulberry32(seed)
      ),
    [exercise.lines, seed]
  );
  const [placed, setPlaced] = useState<number[]>([]);

  useEffect(() => {
    onChange(placed.length === exercise.lines.length ? { kind: 'order', order: placed } : null);
  }, [placed, exercise.lines.length, onChange]);

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-col gap-2" aria-label={t('session.dialogueSlots')}>
        {exercise.lines.map((_, slot) => {
          const lineIndex = placed[slot];
          const line = lineIndex === undefined ? undefined : exercise.lines[lineIndex];
          return (
            <li key={slot} className="flex items-stretch gap-2">
              <span className="flex w-6 shrink-0 items-center justify-center text-xs font-semibold text-muted">
                {slot + 1}
              </span>
              {line ? (
                <button
                  type="button"
                  aria-label={t('session.removeLine', { line: line.text })}
                  onClick={() => {
                    hapticTap();
                    setPlaced(placed.filter((_, i) => i !== slot));
                  }}
                  className="flex min-h-11 flex-1 items-center gap-2 rounded-xl border border-accent bg-accent-soft px-3 py-2 text-left text-[15px] text-text transition-transform active:scale-[0.99]"
                >
                  <SpeakerBadge speaker={line.speaker} />
                  <span className="flex-1">{line.text}</span>
                </button>
              ) : (
                <span
                  aria-label={t('session.dialogueSlot', { index: slot + 1 })}
                  className="min-h-11 flex-1 rounded-xl border border-dashed border-line"
                />
              )}
            </li>
          );
        })}
      </ol>

      <div className="flex flex-col gap-2" aria-label={t('session.dialogueLines')} role="group">
        {shuffled.map((lineIndex) => {
          const line = exercise.lines[lineIndex];
          const used = placed.includes(lineIndex);
          return (
            <button
              key={lineIndex}
              type="button"
              aria-hidden={used || undefined}
              disabled={used}
              aria-label={t('session.addLine', { line: line.text })}
              onClick={() => {
                hapticTap();
                setPlaced([...placed, lineIndex]);
              }}
              className={`flex min-h-11 items-center gap-2 rounded-xl border border-line bg-sheet px-3 py-2 text-left text-[15px] text-text shadow-sm transition-transform active:scale-[0.99] ${
                used ? 'pointer-events-none invisible' : ''
              }`}
            >
              <SpeakerBadge speaker={line.speaker} />
              <span className="flex-1">{line.text}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
