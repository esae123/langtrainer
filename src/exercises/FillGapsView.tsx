import { useEffect, useMemo, useRef, useState } from 'react';
import type { FillGapsExercise } from '../content/types';
import { mulberry32, shuffle } from '../engine/rng';
import { useT } from '../i18n';
import { hapticTap } from '../lib/haptics';
import { AccentBar } from './widgets/AccentBar';
import { insertAtCaret } from './widgets/accents';
import { LetterBoard } from './widgets/LetterBoard';
import { TileButton } from './widgets/TileButton';
import { toTiles } from './widgets/tiles';
import { TypingHint } from './widgets/TypingHint';
import { composeLetters, isLettersComplete } from './widgets/letters';
import type { ExerciseViewProps } from './types';

const GAP = '___';

/** fill_gaps: the template with inline gap chips, filled by tiles, letters or typing. */
export function FillGapsView({
  exercise,
  mode,
  targetLanguage = 'pt-PT',
  seed,
  onChange,
  onSubmit,
}: ExerciseViewProps<FillGapsExercise>) {
  const t = useT();
  const gapCount = exercise.gaps.length;
  const segments = useMemo(() => exercise.template.split(GAP), [exercise.template]);
  const tiles = useMemo(
    () => toTiles(shuffle(exercise.wordBank, mulberry32(seed))),
    [exercise.wordBank, seed]
  );

  /** Tile id per gap (tiles mode). */
  const [assigned, setAssigned] = useState<(string | null)[]>(() => exercise.gaps.map(() => null));
  /** Letters typed per gap (letters mode). */
  const [typed, setTyped] = useState<string[]>(() => exercise.gaps.map(() => ''));
  /** Free text per gap (typing mode). */
  const [texts, setTexts] = useState<string[]>(() => exercise.gaps.map(() => ''));
  const [active, setActive] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const caretRef = useRef<{ gap: number; caret: number } | null>(null);

  const values = useMemo(() => {
    if (mode === 'tiles') {
      const byId = new Map(tiles.map((tile) => [tile.id, tile.label]));
      return assigned.map((id) => (id ? (byId.get(id) ?? '') : ''));
    }
    if (mode === 'letters') {
      return exercise.gaps.map((gap, i) =>
        isLettersComplete(gap.answer, typed[i]) ? composeLetters(gap.answer, typed[i]) : ''
      );
    }
    return texts.map((text) => text.trim());
  }, [mode, assigned, tiles, exercise.gaps, typed, texts]);

  const ready = values.length === gapCount && values.every((value) => value !== '');
  // Serialised so the effect only re-runs when the gap contents really change.
  const valuesKey = JSON.stringify(values);
  useEffect(() => {
    onChange(ready ? { kind: 'gaps', values: JSON.parse(valuesKey) as string[] } : null);
  }, [ready, valuesKey, onChange]);

  useEffect(() => {
    const pending = caretRef.current;
    if (!pending) return;
    caretRef.current = null;
    inputRefs.current[pending.gap]?.setSelectionRange(pending.caret, pending.caret);
  }, [texts]);

  function placeInNextGap(tileId: string) {
    const target = assigned.findIndex((id) => id === null);
    if (target === -1) return;
    setAssigned(assigned.map((id, i) => (i === target ? tileId : id)));
  }

  function renderGap(index: number) {
    const value = values[index];

    if (mode === 'typing') {
      return (
        <input
          key={`gap-${index}`}
          ref={(el) => {
            inputRefs.current[index] = el;
          }}
          type="text"
          value={texts[index]}
          lang={targetLanguage}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          size={Math.max(6, exercise.gaps[index].answer.length)}
          aria-label={t('session.gapAnswer', { index: index + 1 })}
          onFocus={() => setActive(index)}
          onChange={(event) =>
            setTexts(texts.map((text, i) => (i === index ? event.target.value : text)))
          }
          onKeyDown={(event) => {
            if (event.key === 'Enter' && onSubmit) {
              event.preventDefault();
              onSubmit();
            }
          }}
          className="mx-1 inline-block min-h-11 max-w-full rounded-lg border border-line bg-sheet px-2 text-center align-middle text-[17px] text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
        />
      );
    }

    const isActiveGap = mode === 'letters' && active === index;
    return (
      <button
        key={`gap-${index}`}
        type="button"
        aria-label={
          isActiveGap
            ? t('session.gapActive', { index: index + 1 })
            : t('session.gapAnswer', { index: index + 1 })
        }
        onClick={() => {
          hapticTap();
          if (mode === 'tiles') {
            setAssigned(assigned.map((id, i) => (i === index ? null : id)));
            return;
          }
          setActive(index);
        }}
        className={`mx-1 inline-flex min-h-11 min-w-20 items-center justify-center rounded-lg border px-2 align-middle text-[17px] font-medium ${
          value
            ? 'border-accent bg-accent-soft text-text'
            : isActiveGap
              ? 'border-accent bg-sheet text-muted'
              : 'border-dashed border-line bg-sheet text-muted'
        }`}
      >
        {value || GAP}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* The hint follows the active gap (docs/stage-3b-spec.md §3). */}
      {mode === 'typing' && <TypingHint expected={exercise.gaps[active]?.answer ?? null} />}
      <p className="rounded-2xl border border-line bg-sheet px-4 py-3 text-[17px] leading-loose text-text">
        {segments.map((segment, i) => (
          <span key={i}>
            {segment}
            {i < gapCount && renderGap(i)}
          </span>
        ))}
      </p>

      {mode === 'tiles' && (
        <>
          <p className="text-xs text-muted">{t('session.gapTilesHint')}</p>
          <div className="flex flex-wrap gap-2" aria-label={t('session.tileBank')}>
            {tiles.map((tile) => (
              <TileButton
                key={tile.id}
                label={tile.label}
                ariaLabel={t('session.addTile', { word: tile.label })}
                hidden={assigned.includes(tile.id)}
                onClick={() => placeInNextGap(tile.id)}
              />
            ))}
          </div>
        </>
      )}

      {mode === 'letters' && (
        <>
          {gapCount > 1 && <p className="text-xs text-muted">{t('session.gapLettersHint')}</p>}
          <LetterBoard
            key={active}
            answer={exercise.gaps[active].answer}
            typed={typed[active]}
            onChange={(next) => setTyped(typed.map((value, i) => (i === active ? next : value)))}
            seed={seed + active}
            targetLanguage={targetLanguage}
          />
        </>
      )}

      {mode === 'typing' && targetLanguage.toLowerCase().startsWith('pt') && (
        <AccentBar
          onInsert={(char) => {
            const el = inputRefs.current[active];
            const next = insertAtCaret(el, texts[active], char);
            setTexts(texts.map((text, i) => (i === active ? next.value : text)));
            caretRef.current = { gap: active, caret: next.caret };
            el?.focus();
          }}
        />
      )}
    </div>
  );
}
