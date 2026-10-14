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
export function ExerciseArea({ exercise, targetLanguage = 'pt-PT', ...rest }: ExerciseViewProps<Exercise>) {
  const languageProps = { targetLanguage };
  switch (exercise.type) {
    case 'build_phrase':
    case 'question_for_answer':
      return <PhraseExerciseView exercise={exercise} {...languageProps} {...rest} />;
    case 'fill_gaps':
      return <FillGapsView exercise={exercise} {...languageProps} {...rest} />;
    case 'about_me':
      return <AboutMeView exercise={exercise} {...languageProps} {...rest} />;
    case 'find_error':
      return <FindErrorView exercise={exercise} {...languageProps} {...rest} />;
    case 'number_sequence':
      return <NumberSequenceView exercise={exercise} {...languageProps} {...rest} />;
    case 'match_pairs':
      return <MatchPairsView exercise={exercise} {...languageProps} {...rest} />;
    case 'order_dialogue':
      return <OrderDialogueView exercise={exercise} {...languageProps} {...rest} />;
    case 'translate_word':
      return <TranslateWordView exercise={exercise} {...languageProps} {...rest} />;
  }
}
