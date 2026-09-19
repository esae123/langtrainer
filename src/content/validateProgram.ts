// Hand-written runtime validator for Program JSON (content loading + backup/import safety).
// Throws a descriptive Error on the first problem found; returns a typed Program otherwise.
import type {
  AboutMeExercise,
  BuildPhraseExercise,
  Exercise,
  ExerciseType,
  FillGapsExercise,
  FindErrorExercise,
  MatchPairsExercise,
  Module,
  NumberSequenceExercise,
  OrderDialogueExercise,
  PhraseSet,
  Program,
  QuestionForAnswerExercise,
  Topic,
  TranslateWordExercise,
} from './types';
// Explicit ".ts" extension: scripts/content-check.ts and scripts/content-build.ts run this
// module directly via `node` (native TypeScript stripping), which requires fully specified
// ESM import paths for value imports (unlike Vite/tsc's "bundler" resolution).
import { isRecord } from '../lib/isRecord.ts';

class ValidationError extends Error {}

function fail(path: string, message: string): never {
  throw new ValidationError(`Invalid program at "${path}": ${message}`);
}

function str(v: unknown, path: string): string {
  if (typeof v !== 'string') fail(path, 'expected a string');
  return v;
}

function optStr(v: unknown, path: string): string | undefined {
  if (v === undefined) return undefined;
  return str(v, path);
}

function arr(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) fail(path, 'expected an array');
  return v;
}

function num(v: unknown, path: string): number {
  if (typeof v !== 'number' || Number.isNaN(v)) fail(path, 'expected a number');
  return v;
}

function oneOf<T extends string>(v: unknown, options: readonly T[], path: string): T {
  if (typeof v !== 'string' || !options.includes(v as T)) {
    fail(path, `expected one of ${options.join(', ')}`);
  }
  return v as T;
}

const INPUT_MODES = ['tiles', 'letters', 'typing'] as const;
const EXERCISE_TYPES: readonly ExerciseType[] = [
  'build_phrase',
  'fill_gaps',
  'question_for_answer',
  'about_me',
  'find_error',
  'number_sequence',
  'match_pairs',
  'order_dialogue',
  'translate_word',
];

function validateKeyItems(v: unknown, path: string): Topic['keyItems'] {
  return arr(v, path).map((item, i) => {
    if (!isRecord(item)) fail(`${path}[${i}]`, 'expected an object');
    return {
      target: str(item.target, `${path}[${i}].target`),
      support: str(item.support, `${path}[${i}].support`),
      note: optStr(item.note, `${path}[${i}].note`),
    };
  });
}

function validateDifficulty(v: unknown, path: string): 1 | 2 | 3 {
  const n = num(v, path);
  if (n !== 1 && n !== 2 && n !== 3) fail(path, 'expected 1, 2 or 3');
  return n;
}

function validateExerciseBase(v: Record<string, unknown>, path: string) {
  return {
    id: str(v.id, `${path}.id`),
    topicId: str(v.topicId, `${path}.topicId`),
    difficulty: validateDifficulty(v.difficulty, `${path}.difficulty`),
    allowedModes: arr(v.allowedModes, `${path}.allowedModes`).map((m, i) =>
      oneOf(m, INPUT_MODES, `${path}.allowedModes[${i}]`)
    ),
    prompt: str(v.prompt, `${path}.prompt`),
    explanation: str(v.explanation, `${path}.explanation`),
    tags: v.tags === undefined ? undefined : arr(v.tags, `${path}.tags`).map((t, i) => str(t, `${path}.tags[${i}]`)),
  };
}

function validateExercise(v: unknown, path: string): Exercise {
  if (!isRecord(v)) fail(path, 'expected an object');
  const type = oneOf(v.type, EXERCISE_TYPES, `${path}.type`);
  const base = validateExerciseBase(v, path);

  switch (type) {
    case 'build_phrase': {
      const e: BuildPhraseExercise = {
        ...base,
        type,
        answer: arr(v.answer, `${path}.answer`).map((x, i) => str(x, `${path}.answer[${i}]`)),
        distractors: arr(v.distractors, `${path}.distractors`).map((x, i) =>
          str(x, `${path}.distractors[${i}]`)
        ),
        acceptedAnswers:
          v.acceptedAnswers === undefined
            ? undefined
            : arr(v.acceptedAnswers, `${path}.acceptedAnswers`).map((x, i) =>
                str(x, `${path}.acceptedAnswers[${i}]`)
              ),
      };
      return e;
    }
    case 'fill_gaps': {
      const e: FillGapsExercise = {
        ...base,
        type,
        template: str(v.template, `${path}.template`),
        gaps: arr(v.gaps, `${path}.gaps`).map((g, i) => {
          if (!isRecord(g)) fail(`${path}.gaps[${i}]`, 'expected an object');
          return {
            answer: str(g.answer, `${path}.gaps[${i}].answer`),
            accepted:
              g.accepted === undefined
                ? undefined
                : arr(g.accepted, `${path}.gaps[${i}].accepted`).map((x, j) =>
                    str(x, `${path}.gaps[${i}].accepted[${j}]`)
                  ),
          };
        }),
        wordBank: arr(v.wordBank, `${path}.wordBank`).map((x, i) => str(x, `${path}.wordBank[${i}]`)),
      };
      return e;
    }
    case 'question_for_answer': {
      const e: QuestionForAnswerExercise = {
        ...base,
        type,
        givenAnswer: str(v.givenAnswer, `${path}.givenAnswer`),
        answer: arr(v.answer, `${path}.answer`).map((x, i) => str(x, `${path}.answer[${i}]`)),
        distractors: arr(v.distractors, `${path}.distractors`).map((x, i) =>
          str(x, `${path}.distractors[${i}]`)
        ),
        acceptedAnswers:
          v.acceptedAnswers === undefined
            ? undefined
            : arr(v.acceptedAnswers, `${path}.acceptedAnswers`).map((x, i) =>
                str(x, `${path}.acceptedAnswers[${i}]`)
              ),
      };
      return e;
    }
    case 'about_me': {
      const e: AboutMeExercise = {
        ...base,
        type,
        question: str(v.question, `${path}.question`),
        sampleAnswer: str(v.sampleAnswer, `${path}.sampleAnswer`),
        hints: arr(v.hints, `${path}.hints`).map((x, i) => str(x, `${path}.hints[${i}]`)),
      };
      return e;
    }
    case 'find_error': {
      const e: FindErrorExercise = {
        ...base,
        type,
        sentence: arr(v.sentence, `${path}.sentence`).map((x, i) => str(x, `${path}.sentence[${i}]`)),
        wrongIndex: num(v.wrongIndex, `${path}.wrongIndex`),
        correction: str(v.correction, `${path}.correction`),
        options: arr(v.options, `${path}.options`).map((x, i) => str(x, `${path}.options[${i}]`)),
      };
      return e;
    }
    case 'number_sequence': {
      const e: NumberSequenceExercise = {
        ...base,
        type,
        sequence: arr(v.sequence, `${path}.sequence`).map((x, i) =>
          x === null ? null : num(x, `${path}.sequence[${i}]`)
        ),
        answerWords: arr(v.answerWords, `${path}.answerWords`).map((x, i) =>
          str(x, `${path}.answerWords[${i}]`)
        ),
        options: arr(v.options, `${path}.options`).map((x, i) => str(x, `${path}.options[${i}]`)),
      };
      return e;
    }
    case 'match_pairs': {
      const e: MatchPairsExercise = {
        ...base,
        type,
        pairs: arr(v.pairs, `${path}.pairs`).map((p, i) => {
          if (!isRecord(p)) fail(`${path}.pairs[${i}]`, 'expected an object');
          return {
            target: str(p.target, `${path}.pairs[${i}].target`),
            support: str(p.support, `${path}.pairs[${i}].support`),
          };
        }),
      };
      return e;
    }
    case 'order_dialogue': {
      const e: OrderDialogueExercise = {
        ...base,
        type,
        lines: arr(v.lines, `${path}.lines`).map((l, i) => {
          if (!isRecord(l)) fail(`${path}.lines[${i}]`, 'expected an object');
          return {
            speaker: oneOf(l.speaker, ['A', 'B'] as const, `${path}.lines[${i}].speaker`),
            text: str(l.text, `${path}.lines[${i}].text`),
          };
        }),
      };
      return e;
    }
    case 'translate_word': {
      const e: TranslateWordExercise = {
        ...base,
        type,
        direction: oneOf(v.direction, ['toTarget', 'toSupport'] as const, `${path}.direction`),
        sentence: str(v.sentence, `${path}.sentence`),
        word: str(v.word, `${path}.word`),
        answer: str(v.answer, `${path}.answer`),
        options: arr(v.options, `${path}.options`).map((x, i) => str(x, `${path}.options[${i}]`)),
      };
      return e;
    }
  }
}

function validateTopic(v: unknown, path: string): Topic {
  if (!isRecord(v)) fail(path, 'expected an object');
  return {
    id: str(v.id, `${path}.id`),
    moduleId: str(v.moduleId, `${path}.moduleId`),
    title: str(v.title, `${path}.title`),
    kind: oneOf(v.kind, ['grammar', 'vocabulary', 'situation'] as const, `${path}.kind`),
    context: str(v.context, `${path}.context`),
    keyItems: validateKeyItems(v.keyItems, `${path}.keyItems`),
    exercises: arr(v.exercises, `${path}.exercises`).map((e, i) =>
      validateExercise(e, `${path}.exercises[${i}]`)
    ),
  };
}

function validateModule(v: unknown, path: string): Module {
  if (!isRecord(v)) fail(path, 'expected an object');
  return {
    id: str(v.id, `${path}.id`),
    title: str(v.title, `${path}.title`),
    description: str(v.description, `${path}.description`),
    topics: arr(v.topics, `${path}.topics`).map((t, i) => validateTopic(t, `${path}.topics[${i}]`)),
  };
}

function validatePhraseSet(v: unknown, path: string): PhraseSet {
  if (!isRecord(v)) fail(path, 'expected an object');
  return {
    id: str(v.id, `${path}.id`),
    title: str(v.title, `${path}.title`),
    phrases: arr(v.phrases, `${path}.phrases`).map((p, i) => {
      if (!isRecord(p)) fail(`${path}.phrases[${i}]`, 'expected an object');
      return {
        target: str(p.target, `${path}.phrases[${i}].target`),
        support: str(p.support, `${path}.phrases[${i}].support`),
        register:
          p.register === undefined
            ? undefined
            : oneOf(p.register, ['formal', 'informal', 'neutral'] as const, `${path}.phrases[${i}].register`),
        situation: optStr(p.situation, `${path}.phrases[${i}].situation`),
      };
    }),
    exercises: arr(v.exercises, `${path}.exercises`).map((e, i) =>
      validateExercise(e, `${path}.exercises[${i}]`)
    ),
  };
}

/**
 * Validates an arbitrary JSON value as a Program, throwing a descriptive Error if invalid.
 * Only known fields are read, so unknown keys (e.g. the generated file's leading
 * "$generated" marker) are silently ignored rather than rejected.
 */
export function validateProgram(json: unknown): Program {
  if (!isRecord(json)) fail('$', 'expected an object');
  return {
    id: str(json.id, '$.id'),
    title: str(json.title, '$.title'),
    targetLanguage: str(json.targetLanguage, '$.targetLanguage'),
    supportLanguage: str(json.supportLanguage, '$.supportLanguage'),
    level: str(json.level, '$.level'),
    modules: arr(json.modules, '$.modules').map((m, i) => validateModule(m, `$.modules[${i}]`)),
    phraseSets: arr(json.phraseSets, '$.phraseSets').map((p, i) =>
      validatePhraseSet(p, `$.phraseSets[${i}]`)
    ),
  };
}
