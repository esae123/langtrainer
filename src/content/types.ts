// Domain types for LangTrainer content (programs, modules, topics, exercises).
// Defined in Stage 1 so the Dexie schema and future content stages agree on shape.

export type LanguageCode = string; // BCP-47, e.g. 'pt-PT', 'en', 'ru'

export interface Program {
  id: string; // 'pt-PT-A1'
  title: string; // 'Português europeu A1'
  targetLanguage: LanguageCode; // 'pt-PT'
  supportLanguage: LanguageCode; // language of explanations, 'en'
  level: string; // 'A1'
  modules: Module[];
  phraseSets: PhraseSet[]; // everyday phrases (not tied to modules)
}

export interface Module {
  id: string;
  title: string;
  description: string;
  topics: Topic[];
}

export interface Topic {
  id: string; // 'm1-ser-estar'
  moduleId: string;
  title: string;
  kind: 'grammar' | 'vocabulary' | 'situation';
  context: string; // short situation/rule text shown before the block (markdown allowed)
  keyItems: { target: string; support: string; note?: string }[]; // key words/phrases
  exercises: Exercise[];
}

export interface PhraseSet {
  id: string;
  title: string;
  phrases: {
    target: string;
    support: string;
    register?: 'formal' | 'informal' | 'neutral';
    situation?: string;
  }[];
  exercises: Exercise[];
}

export type InputMode = 'tiles' | 'letters' | 'typing';

export type ExerciseType =
  | 'build_phrase'
  | 'fill_gaps'
  | 'question_for_answer'
  | 'about_me'
  | 'find_error'
  | 'number_sequence'
  | 'match_pairs'
  | 'order_dialogue'
  | 'translate_word';

export interface ExerciseBase {
  id: string;
  type: ExerciseType;
  topicId: string; // topic or phraseSet id
  difficulty: 1 | 2 | 3;
  allowedModes: InputMode[]; // which input modes can render this exercise
  prompt: string; // instruction/situation in support language
  explanation: string; // 1-2 lines shown after answering
  tags?: string[]; // e.g. ['ser', 'present', 'articles']
}

export interface BuildPhraseExercise extends ExerciseBase {
  type: 'build_phrase';
  answer: string[];
  distractors: string[];
  acceptedAnswers?: string[];
}

export interface FillGapsExercise extends ExerciseBase {
  type: 'fill_gaps';
  template: string; // 'Eu ___ em Lisboa.' with ___ per gap
  gaps: { answer: string; accepted?: string[] }[];
  wordBank: string[]; // answers + distractors
}

export interface QuestionForAnswerExercise extends ExerciseBase {
  type: 'question_for_answer';
  givenAnswer: string;
  answer: string[];
  distractors: string[];
  acceptedAnswers?: string[];
}

export interface AboutMeExercise extends ExerciseBase {
  type: 'about_me';
  question: string;
  sampleAnswer: string;
  hints: string[];
}

export interface FindErrorExercise extends ExerciseBase {
  type: 'find_error';
  sentence: string[];
  wrongIndex: number;
  correction: string;
  options: string[];
}

export interface NumberSequenceExercise extends ExerciseBase {
  type: 'number_sequence';
  sequence: (number | null)[];
  answerWords: string[];
  options: string[];
}

export interface MatchPairsExercise extends ExerciseBase {
  type: 'match_pairs';
  pairs: { target: string; support: string }[];
}

export interface OrderDialogueExercise extends ExerciseBase {
  type: 'order_dialogue';
  lines: { speaker: 'A' | 'B'; text: string }[]; // correct order
}

export interface TranslateWordExercise extends ExerciseBase {
  type: 'translate_word';
  direction: 'toTarget' | 'toSupport';
  sentence: string;
  word: string;
  answer: string;
  options: string[];
}

export type Exercise =
  | BuildPhraseExercise
  | FillGapsExercise
  | QuestionForAnswerExercise
  | AboutMeExercise
  | FindErrorExercise
  | NumberSequenceExercise
  | MatchPairsExercise
  | OrderDialogueExercise
  | TranslateWordExercise;
