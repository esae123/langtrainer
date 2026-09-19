import { useEffect, useMemo, useState } from 'react';
import type { MatchPairsExercise } from '../content/types';
import { mulberry32, shuffle } from '../engine/rng';
import { useT } from '../i18n';
import { hapticTap } from '../lib/haptics';
import { TileButton } from './widgets/TileButton';
import type { ExerciseViewProps } from './types';

/**
 * match_pairs: two shuffled columns. Tap a target, then its translation; correct pairs
 * lock, wrong ones shake and are counted. The exercise completes itself once every pair
 * is matched, so the primary button turns into "Continue".
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

  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [matched, setMatched] = useState<string[]>([]);
  const [wrongPairings, setWrongPairings] = useState(0);
  const [shaking, setShaking] = useState<string | null>(null);

  const done = matched.length === exercise.pairs.length;
  useEffect(() => {
    onChange(
      done
        ? {
            kind: 'pairs',
            pairs: exercise.pairs.filter((pair) => matched.includes(pair.target)),
            wrongPairings,
          }
        : null
    );
  }, [done, matched, wrongPairings, exercise.pairs, onChange]);

  useEffect(() => {
    if (!shaking) return;
    const timer = window.setTimeout(() => setShaking(null), 400);
    return () => window.clearTimeout(timer);
  }, [shaking]);

  const supportOf = (target: string) => exercise.pairs.find((p) => p.target === target)?.support;
  const isMatchedSupport = (support: string) =>
    matched.some((target) => supportOf(target) === support);

  function chooseSupport(support: string) {
    if (!selectedTarget) return;
    if (supportOf(selectedTarget) === support) {
      setMatched([...matched, selectedTarget]);
      setSelectedTarget(null);
      return;
    }
    setWrongPairings(wrongPairings + 1);
    setShaking(support);
    setSelectedTarget(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {done ? t('session.matchDone') : t('session.matchHint')}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2" aria-label={t('session.matchTargets')} role="group">
          {targets.map((target) => {
            const locked = matched.includes(target);
            return (
              <TileButton
                key={target}
                label={target}
                variant={locked ? 'locked' : selectedTarget === target ? 'selected' : 'bank'}
                ariaPressed={selectedTarget === target}
                disabled={locked}
                className="w-full"
                onClick={() => {
                  hapticTap();
                  setSelectedTarget(target);
                }}
              />
            );
          })}
        </div>
        <div className="flex flex-col gap-2" aria-label={t('session.matchSupports')} role="group">
          {supports.map((support) => {
            const locked = isMatchedSupport(support);
            return (
              <TileButton
                key={support}
                label={support}
                variant={locked ? 'locked' : 'bank'}
                disabled={locked}
                shake={shaking === support}
                className="w-full"
                onClick={() => chooseSupport(support)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
