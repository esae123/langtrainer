// Small content fixtures shared by engine and session tests.
import type {
  BuildPhraseExercise,
  Exercise,
  InputMode,
  Module,
  PhraseSet,
  Program,
  Topic,
  TranslateWordExercise,
} from '../content/types';
import { emptyTopicProgress } from '../engine/progress';
import type { TopicProgress } from '../engine/types';

const ALL_MODES: InputMode[] = ['tiles', 'letters', 'typing'];

export function makeTranslateWord(
  id: string,
  topicId: string,
  overrides: Partial<TranslateWordExercise> = {}
): TranslateWordExercise {
  return {
    id,
    type: 'translate_word',
    topicId,
    difficulty: 1,
    allowedModes: ALL_MODES,
    prompt: 'Translate the word in bold.',
    explanation: 'Because of the ending.',
    direction: 'toTarget',
    sentence: 'I **work** here.',
    word: 'work',
    answer: 'trabalho',
    options: ['trabalho', 'trabalhas', 'trabalha', 'trabalham'],
    ...overrides,
  };
}

export function makeBuildPhrase(
  id: string,
  topicId: string,
  overrides: Partial<BuildPhraseExercise> = {}
): BuildPhraseExercise {
  return {
    id,
    type: 'build_phrase',
    topicId,
    difficulty: 1,
    allowedModes: ALL_MODES,
    prompt: "Build: 'I speak English.'",
    explanation: 'The eu ending is -o.',
    answer: ['Eu', 'falo', 'inglês.'],
    distractors: ['falas'],
    acceptedAnswers: ['Falo inglês.'],
    ...overrides,
  };
}

export function makeTopic(
  id: string,
  moduleId: string,
  exerciseCount: number,
  overrides: Partial<Topic> = {}
): Topic {
  return {
    id,
    moduleId,
    title: `Topic ${id}`,
    kind: 'grammar',
    context: `## ${id}\n\nA short rule with **bold** text.`,
    keyItems: [{ target: 'falar', support: 'to speak', note: 'regular -ar' }],
    exercises: Array.from({ length: exerciseCount }, (_, i) =>
      makeTranslateWord(`${id}-e${i + 1}`, id, { difficulty: ((i % 3) + 1) as 1 | 2 | 3 })
    ),
    ...overrides,
  };
}

export function makePhraseSet(
  id: string,
  exerciseCount: number,
  overrides: Partial<PhraseSet> = {}
): PhraseSet {
  return {
    id,
    title: `Phrase set ${id}`,
    phrases: [{ target: 'Bom dia', support: 'Good morning', register: 'neutral' }],
    exercises: Array.from({ length: exerciseCount }, (_, i) =>
      makeTranslateWord(`${id}-p${i + 1}`, id)
    ),
    ...overrides,
  };
}

export function makeProgram(modules: Module[], phraseSets: PhraseSet[] = []): Program {
  return {
    id: 'pt-PT-A1',
    title: 'Português europeu A1',
    targetLanguage: 'pt-PT',
    supportLanguage: 'en',
    level: 'A1',
    modules,
    phraseSets,
  };
}

/** A program with two topics (40 exercises each) and one phrase set. */
export function makeStandardProgram(): Program {
  return makeProgram(
    [
      {
        id: 'm1',
        title: 'Module 1',
        description: 'Basics',
        topics: [makeTopic('t1', 'm1', 40), makeTopic('t2', 'm1', 40)],
      },
      {
        id: 'm2',
        title: 'Module 2',
        description: 'More',
        topics: [makeTopic('t3', 'm2', 40)],
      },
    ],
    [makePhraseSet('ps1', 12)]
  );
}

export function makeProgress(
  topicId: string,
  overrides: Partial<TopicProgress> = {}
): TopicProgress {
  return { ...emptyTopicProgress(topicId, 'pt-PT-A1'), ...overrides };
}

/** Exercise ids of a topic, in authored order. */
export function exerciseIds(exercises: Exercise[]): string[] {
  return exercises.map((e) => e.id);
}
