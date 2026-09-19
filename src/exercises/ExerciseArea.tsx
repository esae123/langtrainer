import type { Exercise } from '../content/types';
import { AboutMeView } from './AboutMeView';
import { FillGapsView } from './FillGapsView';
import { FindErrorView } from './FindErrorView';
import { MatchPairsView } from './MatchPairsView';
import { NumberSequenceView } from './NumberSequenceView';
import { OrderDialogueView } from './OrderDialogueView';
import { PhraseExerciseView } from './PhraseExerciseView';
import { TranslateWordView } from './TranslateWordView';
import type { ExerciseViewProps } from './types';

/** Picks the renderer for an exercise type. Mount with `key={exercise.id}`. */
export function ExerciseArea({ exercise, ...rest }: ExerciseViewProps<Exercise>) {
  switch (exercise.type) {
    case 'build_phrase':
    case 'question_for_answer':
      return <PhraseExerciseView exercise={exercise} {...rest} />;
    case 'fill_gaps':
      return <FillGapsView exercise={exercise} {...rest} />;
    case 'about_me':
      return <AboutMeView exercise={exercise} {...rest} />;
    case 'find_error':
      return <FindErrorView exercise={exercise} {...rest} />;
    case 'number_sequence':
      return <NumberSequenceView exercise={exercise} {...rest} />;
    case 'match_pairs':
      return <MatchPairsView exercise={exercise} {...rest} />;
    case 'order_dialogue':
      return <OrderDialogueView exercise={exercise} {...rest} />;
    case 'translate_word':
      return <TranslateWordView exercise={exercise} {...rest} />;
  }
}
