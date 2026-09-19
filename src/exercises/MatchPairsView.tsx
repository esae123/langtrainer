import { useEffect, useMemo, useState } from 'react';
import type { MatchPairsExercise } from '../content/types';
import { mulberry32, shuffle } from '../engine/rng';
import { useT } from '../i18n';
import { hapticTap } from '../lib/haptics';
import { TileButton } from './widgets/TileButton';
import type { ExerciseViewProps } from './types';

interface Link {
  target: string;
  support: string;
}

/**
 * match_pairs: two shuffled columns with free pairing (docs/stage-3b-spec.md §1). Any
 * target can be linked to any translation — mis-taps cost nothing. Linked items carry
 * the same number badge on both sides; tapping either one breaks the link again. The
 * answer is only reported once every item is paired, so Check stays disabled until then
 * and the whole set is graded in one go.
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
  const [selectedSupport, setSelectedSupport] = useState<string | null>(null);
  const [links, setLinks] = useState<Link[]>([]);

  const done = links.length === exercise.pairs.length;
  useEffect(() => {
    onChange(done ? { kind: 'pairs', pairs: links } : null);
  }, [done, links, onChange]);

  const linkOfTarget = (target: string) => links.findIndex((link) => link.target === target);
  const linkOfSupport = (support: string) => links.findIndex((link) => link.support === support);

  function connect(target: string, support: string) {
    setLinks([...links, { target, support }]);
    setSelectedTarget(null);
    setSelectedSupport(null);
  }

  function disconnect(index: number) {
    setLinks(links.filter((_, i) => i !== index));
    setSelectedTarget(null);
    setSelectedSupport(null);
  }

  function tapTarget(target: string) {
    hapticTap();
    const linked = linkOfTarget(target);
    if (linked !== -1) {
      disconnect(linked);
      return;
    }
    if (selectedSupport !== null) {
      connect(target, selectedSupport);
      return;
    }
    setSelectedTarget(selectedTarget === target ? null : target);
  }

  function tapSupport(support: string) {
    hapticTap();
    const linked = linkOfSupport(support);
    if (linked !== -1) {
      disconnect(linked);
      return;
    }
    if (selectedTarget !== null) {
      connect(selectedTarget, support);
      return;
    }
    setSelectedSupport(selectedSupport === support ? null : support);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted">{done ? t('session.matchDone') : t('session.matchHint')}</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2" aria-label={t('session.matchTargets')} role="group">
          {targets.map((target) => {
            const linked = linkOfTarget(target);
            return (
              <TileButton
                key={target}
                label={target}
                variant={linked !== -1 ? 'placed' : selectedTarget === target ? 'selected' : 'bank'}
                ariaLabel={
                  linked !== -1
                    ? t('session.matchUnlink', { item: target, number: linked + 1 })
                    : target
                }
                ariaPressed={selectedTarget === target || linked !== -1}
                badge={linked === -1 ? undefined : linked + 1}
                className="w-full"
                onClick={() => tapTarget(target)}
              />
            );
          })}
        </div>
        <div className="flex flex-col gap-2" aria-label={t('session.matchSupports')} role="group">
          {supports.map((support) => {
            const linked = linkOfSupport(support);
            return (
              <TileButton
                key={support}
                label={support}
                variant={
                  linked !== -1 ? 'placed' : selectedSupport === support ? 'selected' : 'bank'
                }
                ariaLabel={
                  linked !== -1
                    ? t('session.matchUnlink', { item: support, number: linked + 1 })
                    : support
                }
                ariaPressed={selectedSupport === support || linked !== -1}
                badge={linked === -1 ? undefined : linked + 1}
                className="w-full"
                onClick={() => tapSupport(support)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
