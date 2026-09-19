import { useEffect, useMemo, useState } from 'react';
import type { AboutMeExercise } from '../content/types';
import { mulberry32, shuffle } from '../engine/rng';
import { useT } from '../i18n';
import { TileBank } from './widgets/TileBank';
import { toTiles } from './widgets/tiles';
import { TypingInput } from './widgets/TypingInput';
import type { ExerciseViewProps } from './types';

/**
 * about_me: the learner answers freely. Tiles are only a scaffold (sample answer tokens
 * plus hint words) and may be left unused; the grading happens in the feedback sheet.
 */
export function AboutMeView({
  exercise,
  mode,
  seed,
  onChange,
  onSubmit,
}: ExerciseViewProps<AboutMeExercise>) {
  const t = useT();
  const tiles = useMemo(
    () =>
      toTiles(
        shuffle(
          [...exercise.sampleAnswer.split(/\s+/).filter(Boolean), ...exercise.hints],
          mulberry32(seed)
        )
      ),
    [exercise.sampleAnswer, exercise.hints, seed]
  );
  const [placedIds, setPlacedIds] = useState<string[]>([]);
  const [text, setText] = useState('');

  useEffect(() => {
    if (mode === 'tiles') {
      const byId = new Map(tiles.map((tile) => [tile.id, tile.label]));
      const tokens = placedIds.map((id) => byId.get(id) ?? '');
      onChange(tokens.length > 0 ? { kind: 'tokens', tokens } : null);
      return;
    }
    onChange(text.trim() === '' ? null : { kind: 'text', text });
  }, [mode, placedIds, tiles, text, onChange]);

  return (
    <div className="flex flex-col gap-4">
      <div className="max-w-[90%] self-start rounded-2xl rounded-bl-sm bg-accent-soft px-4 py-3 text-[17px] text-text">
        {exercise.question}
      </div>

      {mode === 'tiles' ? (
        <>
          <p className="text-xs text-muted">{t('session.aboutMeHint')}</p>
          <TileBank tiles={tiles} placedIds={placedIds} onChange={setPlacedIds} />
        </>
      ) : (
        <TypingInput
          value={text}
          onChange={setText}
          onSubmit={onSubmit}
          multiline
          label={t('session.typeAnswer')}
          placeholder={t('session.typeAnswerPlaceholder')}
        />
      )}
    </div>
  );
}
