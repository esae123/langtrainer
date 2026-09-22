import { useEffect, useMemo, useState } from 'react';
import type { MatchPairsExercise } from '../content/types';
import { mulberry32, shuffle } from '../engine/rng';
import { useT } from '../i18n';
import { hapticTap } from '../lib/haptics';
import { TileButton } from './widgets/TileButton';
import type { ExerciseViewProps } from './types';

/**
 * One link, by column position rather than by text: two pairs may well share the same
 * translation ("you speak" for both `falas` and `fala`), so positions are what make an
 * item unique.
 */
interface Link {
  target: number;
  support: number;
}

/**
 * match_pairs: two shuffled columns with free pairing (docs/stage-3b-spec.md §1). Any
 * target can be linked to any translation — mis-taps cost nothing. Linked items carry
 * the same number badge on both sides; tapping either one breaks the link again, and
 * the freed slot keeps its number so the other badges never renumber. The answer is
 * only reported once every item is paired, so Check stays disabled until then and the
 * whole set is graded in one go.
 */
export function MatchPairsView({
  exercise,
  seed,
  onChange,
}: ExerciseViewProps<MatchPairsExercise>) {
  const t = useT();
  const rng = useMemo(() => mulberry32(seed), [seed]);
  const targets = useMemo(
    () =>
      shuffle(
        exercise.pairs.map((p) => p.target),
        rng
      ),
    [exercise.pairs, rng]
  );
  const supports = useMemo(
    () =>
      shuffle(
        exercise.pairs.map((p) => p.support),
        rng
      ),
    [exercise.pairs, rng]
  );

  const [selectedTarget, setSelectedTarget] = useState<number | null>(null);
  const [selectedSupport, setSelectedSupport] = useState<number | null>(null);
  /** One slot per pair; `null` once its link has been undone. */
  const [slots, setSlots] = useState<(Link | null)[]>(() => exercise.pairs.map(() => null));

  const done = slots.every((slot) => slot !== null);

  useEffect(() => {
    const linked = slots.filter((slot): slot is Link => slot !== null);
    onChange(
      linked.length === slots.length
        ? {
            kind: 'pairs',
            pairs: linked.map((slot) => ({
              target: targets[slot.target],
              support: supports[slot.support],
            })),
          }
        : null
    );
  }, [slots, targets, supports, onChange]);

  const slotOfTarget = (index: number) => slots.findIndex((slot) => slot?.target === index);
  const slotOfSupport = (index: number) => slots.findIndex((slot) => slot?.support === index);

  function connect(target: number, support: number) {
    const free = slots.findIndex((slot) => slot === null);
    if (free === -1) return;
    setSlots(slots.map((slot, i) => (i === free ? { target, support } : slot)));
    setSelectedTarget(null);
    setSelectedSupport(null);
  }

  /** Frees the slot in place, so the remaining badge numbers stay put. */
  function disconnect(slotIndex: number) {
    setSlots(slots.map((slot, i) => (i === slotIndex ? null : slot)));
    setSelectedTarget(null);
    setSelectedSupport(null);
  }

  function tapTarget(index: number) {
    hapticTap();
    const slot = slotOfTarget(index);
    if (slot !== -1) {
      disconnect(slot);
      return;
    }
    if (selectedSupport !== null) {
      connect(index, selectedSupport);
      return;
    }
    setSelectedTarget(selectedTarget === index ? null : index);
  }

  function tapSupport(index: number) {
    hapticTap();
    const slot = slotOfSupport(index);
    if (slot !== -1) {
      disconnect(slot);
      return;
    }
    if (selectedTarget !== null) {
      connect(selectedTarget, index);
      return;
    }
    setSelectedSupport(selectedSupport === index ? null : index);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted">{done ? t('session.matchDone') : t('session.matchHint')}</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2" aria-label={t('session.matchTargets')} role="group">
          {targets.map((target, index) => {
            const slot = slotOfTarget(index);
            return (
              <TileButton
                key={index}
                label={target}
                variant={slot !== -1 ? 'placed' : selectedTarget === index ? 'selected' : 'bank'}
                ariaLabel={
                  slot !== -1
                    ? t('session.matchUnlink', { item: target, number: slot + 1 })
                    : target
                }
                ariaPressed={selectedTarget === index || slot !== -1}
                badge={slot === -1 ? undefined : slot + 1}
                className="w-full"
                onClick={() => tapTarget(index)}
              />
            );
          })}
        </div>
        <div className="flex flex-col gap-2" aria-label={t('session.matchSupports')} role="group">
          {supports.map((support, index) => {
            const slot = slotOfSupport(index);
            return (
              <TileButton
                key={index}
                label={support}
                variant={slot !== -1 ? 'placed' : selectedSupport === index ? 'selected' : 'bank'}
                ariaLabel={
                  slot !== -1
                    ? t('session.matchUnlink', { item: support, number: slot + 1 })
                    : support
                }
                ariaPressed={selectedSupport === index || slot !== -1}
                badge={slot === -1 ? undefined : slot + 1}
                className="w-full"
                onClick={() => tapSupport(index)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
