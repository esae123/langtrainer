// Pure content-quality checks for authored Program data, layered on top of the structural
// validation in validateProgram.ts. Never throws — collects every problem it finds so a
// content check can report them all at once. See docs/content-authoring.md §4-5 for the
// rules this file enforces.
import type {
  AboutMeExercise,
  BuildPhraseExercise,
  Exercise,
  ExerciseType,
  FillGapsExercise,
  FindErrorExercise,
  InputMode,
  MatchPairsExercise,
  NumberSequenceExercise,
  OrderDialogueExercise,
  Program,
  QuestionForAnswerExercise,
  TranslateWordExercise,
} from './types';

export interface ContentProblem {
  path: string;
  message: string;
  /** 'error' (default when absent) blocks content:check/build; 'warning' is informational only. */
  severity?: 'error' | 'warning';
  /** The id of the exercise this problem belongs to, e.g. "m2-family-pets-24" (stage 4b report). */
  exerciseId?: string;
  /** 1-based position of the exercise within its topic/phrase-set (exercises[i] is number i+1). */
  exerciseNumber?: number;
  /** Total number of exercises in the containing topic/phrase-set. */
  exerciseCount?: number;
}

export interface ContentStats {
  exerciseCount: number;
  byType: Partial<Record<ExerciseType, number>>;
  byDifficulty: Record<'1' | '2' | '3', number>;
}

export interface ContentCheckResult {
  problems: ContentProblem[];
  /** Keyed by topic id or phrase-set id. */
  stats: Record<string, ContentStats>;
}

const ALLOWED_MODES_BY_TYPE: Record<ExerciseType, InputMode[]> = {
  build_phrase: ['tiles', 'letters', 'typing'],
  fill_gaps: ['tiles', 'letters', 'typing'],
  question_for_answer: ['tiles', 'letters', 'typing'],
  about_me: ['tiles', 'typing'],
  find_error: ['tiles', 'letters'],
  number_sequence: ['tiles', 'letters', 'typing'],
  match_pairs: ['tiles'],
  order_dialogue: ['tiles'],
  translate_word: ['tiles', 'letters', 'typing'],
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function words(s: string): string[] {
  return s.trim().split(/\s+/).filter(Boolean);
}

function wordCount(s: string): number {
  return words(s).length;
}

function hasDuplicates(items: string[]): boolean {
  return new Set(items).size !== items.length;
}

/**
 * Normalises a token for "same word" comparisons that should ignore case, trailing sentence
 * punctuation and guillemets: "Tens" / "tens?" / "«tens»" all normalise to "tens". Used to catch
 * distractors that are really the answer in disguise (docs/stage-4b-spec.md follow-up).
 */
function normalizeToken(s: string): string {
  return s
    .trim()
    .replace(/^[«»]+/, '')
    .replace(/[«»]+$/, '')
    .replace(/[.!?]+$/, '')
    .toLowerCase();
}

/** Common invariants shared by every exercise type (docs/content-authoring.md §4, "Common"). */
function checkCommon(exercise: Exercise, containerId: string, path: string, problems: ContentProblem[]): void {
  const idPattern = new RegExp(`^${escapeRegExp(containerId)}-\\d{2,}$`);
  if (!idPattern.test(exercise.id)) {
    problems.push({
      path: `${path}.id`,
      message: `id "${exercise.id}" must match the pattern "${containerId}-nn"`,
    });
  }

  if (exercise.topicId !== containerId) {
    problems.push({
      path: `${path}.topicId`,
      message: `topicId "${exercise.topicId}" must equal the containing topic/phrase-set id "${containerId}"`,
    });
  }

  if (exercise.allowedModes.length === 0) {
    problems.push({ path: `${path}.allowedModes`, message: 'allowedModes must not be empty' });
  }
  const allowedForType = ALLOWED_MODES_BY_TYPE[exercise.type];
  for (const mode of exercise.allowedModes) {
    if (!allowedForType.includes(mode)) {
      problems.push({
        path: `${path}.allowedModes`,
        message: `mode "${mode}" is not allowed for exercise type "${exercise.type}" (allowed: ${allowedForType.join(', ')})`,
      });
    }
  }
  if (
    (exercise.type === 'build_phrase' || exercise.type === 'question_for_answer') &&
    exercise.allowedModes.includes('letters') &&
    exercise.answer.length > 4
  ) {
    problems.push({
      path: `${path}.allowedModes`,
      message: '"letters" mode is only allowed when answer is 4 words or fewer',
    });
  }

  if (exercise.difficulty < 1 || exercise.difficulty > 3) {
    problems.push({ path: `${path}.difficulty`, message: 'difficulty must be 1, 2 or 3' });
  }
  if (exercise.prompt.trim().length === 0) {
    problems.push({ path: `${path}.prompt`, message: 'prompt must not be empty' });
  }
  if (exercise.explanation.trim().length === 0) {
    problems.push({ path: `${path}.explanation`, message: 'explanation must not be empty' });
  }
}

function checkBuildPhrase(e: BuildPhraseExercise, path: string, problems: ContentProblem[]): void {
  const n = e.answer.length;
  if (n < 2 || n > 10) {
    problems.push({ path: `${path}.answer`, message: `answer must have 2-10 words (has ${n})` });
  }
  if (e.distractors.length < 1 || e.distractors.length > 4) {
    problems.push({
      path: `${path}.distractors`,
      message: `distractors must have 1-4 items (has ${e.distractors.length})`,
    });
  }
  const answerNorm = e.answer.map(normalizeToken);
  for (const d of e.distractors) {
    if (answerNorm.includes(normalizeToken(d))) {
      problems.push({
        path: `${path}.distractors`,
        message: `distractor "${d}" duplicates an answer word (case/punctuation-insensitive)`,
      });
    }
  }
}

function checkFillGaps(e: FillGapsExercise, path: string, problems: ContentProblem[]): void {
  const gapMarkerCount = (e.template.match(/___/g) ?? []).length;
  if (gapMarkerCount !== e.gaps.length) {
    problems.push({
      path: `${path}.template`,
      message: `template has ${gapMarkerCount} "___" markers but gaps has ${e.gaps.length} entries`,
    });
  }
  if (e.gaps.length < 1 || e.gaps.length > 3) {
    problems.push({ path: `${path}.gaps`, message: `gaps must have 1-3 items (has ${e.gaps.length})` });
  }

  const gapAnswers = e.gaps.map((g) => g.answer);
  const missing = gapAnswers.filter((a) => !e.wordBank.includes(a));
  if (missing.length > 0) {
    problems.push({
      path: `${path}.wordBank`,
      message: `wordBank must contain every gap answer, missing: ${missing.join(', ')}`,
    });
  }
  if (hasDuplicates(e.wordBank)) {
    problems.push({ path: `${path}.wordBank`, message: 'wordBank must not contain duplicates' });
  }
  const distractorCount = e.wordBank.filter((w) => !gapAnswers.includes(w)).length;
  if (distractorCount < 2 || distractorCount > 4) {
    problems.push({
      path: `${path}.wordBank`,
      message: `wordBank must contain 2-4 distractor words beyond the gap answers (found ${distractorCount})`,
    });
  }
}

function checkQuestionForAnswer(e: QuestionForAnswerExercise, path: string, problems: ContentProblem[]): void {
  if (e.givenAnswer.trim().length === 0) {
    problems.push({ path: `${path}.givenAnswer`, message: 'givenAnswer must not be empty' });
  }
  const n = e.answer.length;
  if (n < 2 || n > 8) {
    problems.push({ path: `${path}.answer`, message: `answer must have 2-8 words (has ${n})` });
  }
  const last = e.answer[e.answer.length - 1];
  if (last === undefined || !last.includes('?')) {
    problems.push({
      path: `${path}.answer`,
      message: 'the last word of answer must contain "?" (answer is a question)',
    });
  }
  if (e.distractors.length < 1 || e.distractors.length > 4) {
    problems.push({
      path: `${path}.distractors`,
      message: `distractors must have 1-4 items (has ${e.distractors.length})`,
    });
  }
  const answerNorm = e.answer.map(normalizeToken);
  for (const d of e.distractors) {
    if (answerNorm.includes(normalizeToken(d))) {
      problems.push({
        path: `${path}.distractors`,
        message: `distractor "${d}" duplicates an answer word (case/punctuation-insensitive)`,
      });
    }
  }
}

function checkAboutMe(e: AboutMeExercise, path: string, problems: ContentProblem[]): void {
  if (e.question.trim().length === 0) {
    problems.push({ path: `${path}.question`, message: 'question must not be empty' });
  }
  const n = wordCount(e.sampleAnswer);
  if (n < 2 || n > 12) {
    problems.push({ path: `${path}.sampleAnswer`, message: `sampleAnswer must have 2-12 words (has ${n})` });
  }
  if (e.hints.length < 3 || e.hints.length > 8) {
    problems.push({ path: `${path}.hints`, message: `hints must have 3-8 items (has ${e.hints.length})` });
  }
  const sampleNorm = words(e.sampleAnswer).map(normalizeToken);
  for (const h of e.hints) {
    if (sampleNorm.includes(normalizeToken(h))) {
      problems.push({
        path: `${path}.hints`,
        message: `hint "${h}" duplicates a sampleAnswer word (case/punctuation-insensitive) — the tile bank would show it twice`,
        severity: 'warning',
      });
    }
  }
}

function checkFindError(e: FindErrorExercise, path: string, problems: ContentProblem[]): void {
  const n = e.sentence.length;
  if (n < 3 || n > 10) {
    problems.push({ path: `${path}.sentence`, message: `sentence must have 3-10 tokens (has ${n})` });
  }
  if (e.wrongIndex < 0 || e.wrongIndex >= n) {
    problems.push({ path: `${path}.wrongIndex`, message: 'wrongIndex must be a valid index into sentence' });
  }
  const wrongToken = e.sentence[e.wrongIndex];
  if (wrongToken !== undefined && e.correction === wrongToken) {
    problems.push({ path: `${path}.correction`, message: 'correction must differ from sentence[wrongIndex]' });
  }
  if (e.options.length < 3 || e.options.length > 4) {
    problems.push({ path: `${path}.options`, message: `options must have 3-4 items (has ${e.options.length})` });
  }
  if (!e.options.includes(e.correction)) {
    problems.push({ path: `${path}.options`, message: 'options must include correction' });
  }
  if (wrongToken !== undefined && e.options.includes(wrongToken)) {
    problems.push({ path: `${path}.options`, message: 'options must not include sentence[wrongIndex]' });
  }
}

function checkNumberSequence(e: NumberSequenceExercise, path: string, problems: ContentProblem[]): void {
  const n = e.sequence.length;
  if (n < 4 || n > 6) {
    problems.push({ path: `${path}.sequence`, message: `sequence must have 4-6 items (has ${n})` });
  }
  const nullCount = e.sequence.filter((x) => x === null).length;
  if (nullCount !== 1) {
    problems.push({
      path: `${path}.sequence`,
      message: `sequence must contain exactly one null (has ${nullCount})`,
    });
  }
  if (e.answerWords.length < 1 || e.answerWords.length > 2) {
    problems.push({
      path: `${path}.answerWords`,
      message: `answerWords must have 1-2 items (has ${e.answerWords.length})`,
    });
  }
  if (e.options.length < 4 || e.options.length > 6) {
    problems.push({ path: `${path}.options`, message: `options must have 4-6 items (has ${e.options.length})` });
  }
  if (e.answerWords[0] !== undefined && !e.options.includes(e.answerWords[0])) {
    problems.push({ path: `${path}.options`, message: 'options must include answerWords[0]' });
  }
}

function checkMatchPairs(e: MatchPairsExercise, path: string, problems: ContentProblem[]): void {
  const n = e.pairs.length;
  if (n < 4 || n > 6) {
    problems.push({ path: `${path}.pairs`, message: `pairs must have 4-6 items (has ${n})` });
  }
  if (hasDuplicates(e.pairs.map((p) => p.target))) {
    problems.push({ path: `${path}.pairs`, message: 'pairs targets must be unique' });
  }
  if (hasDuplicates(e.pairs.map((p) => p.support))) {
    problems.push({ path: `${path}.pairs`, message: 'pairs supports must be unique' });
  }
}

function checkOrderDialogue(e: OrderDialogueExercise, path: string, problems: ContentProblem[]): void {
  const n = e.lines.length;
  if (n < 3 || n > 6) {
    problems.push({ path: `${path}.lines`, message: `lines must have 3-6 items (has ${n})` });
  }
  if (e.lines[0] !== undefined && e.lines[0].speaker !== 'A') {
    problems.push({ path: `${path}.lines`, message: 'the first line must be spoken by A' });
  }
  for (let i = 1; i < e.lines.length; i++) {
    if (e.lines[i].speaker === e.lines[i - 1].speaker) {
      problems.push({ path: `${path}.lines[${i}]`, message: 'speakers must alternate between A and B' });
    }
  }
}

function checkTranslateWord(e: TranslateWordExercise, path: string, problems: ContentProblem[]): void {
  if (!e.sentence.includes(e.word)) {
    problems.push({ path: `${path}.sentence`, message: `sentence must contain the word "${e.word}"` });
  }
  if (e.options.length !== 4) {
    problems.push({ path: `${path}.options`, message: `options must have exactly 4 items (has ${e.options.length})` });
  }
  if (!e.options.includes(e.answer)) {
    problems.push({ path: `${path}.options`, message: 'options must include answer' });
  }
}

function checkByType(exercise: Exercise, path: string, problems: ContentProblem[]): void {
  switch (exercise.type) {
    case 'build_phrase':
      checkBuildPhrase(exercise, path, problems);
      return;
    case 'fill_gaps':
      checkFillGaps(exercise, path, problems);
      return;
    case 'question_for_answer':
      checkQuestionForAnswer(exercise, path, problems);
      return;
    case 'about_me':
      checkAboutMe(exercise, path, problems);
      return;
    case 'find_error':
      checkFindError(exercise, path, problems);
      return;
    case 'number_sequence':
      checkNumberSequence(exercise, path, problems);
      return;
    case 'match_pairs':
      checkMatchPairs(exercise, path, problems);
      return;
    case 'order_dialogue':
      checkOrderDialogue(exercise, path, problems);
      return;
    case 'translate_word':
      checkTranslateWord(exercise, path, problems);
      return;
  }
}

/**
 * The "target sentence" used to detect duplicate exercises within a topic — the joined
 * `answer`/`template`/`sentence` field, per docs/content-authoring.md §4. Types without one
 * of those fields (about_me, match_pairs, order_dialogue, number_sequence) are exempt.
 */
function comparableSentence(exercise: Exercise): string | undefined {
  switch (exercise.type) {
    case 'build_phrase':
    case 'question_for_answer':
      return exercise.answer.join(' ');
    case 'fill_gaps':
      return exercise.template;
    case 'find_error':
      return exercise.sentence.join(' ');
    case 'translate_word':
      return exercise.sentence;
    default:
      return undefined;
  }
}

/** Computes exercise-count / type-mix / difficulty-mix stats for one topic or phrase set. */
export function computeStats(exercises: Exercise[]): ContentStats {
  const byType: Partial<Record<ExerciseType, number>> = {};
  const byDifficulty: Record<'1' | '2' | '3', number> = { '1': 0, '2': 0, '3': 0 };
  for (const exercise of exercises) {
    byType[exercise.type] = (byType[exercise.type] ?? 0) + 1;
    const key = String(exercise.difficulty) as '1' | '2' | '3';
    byDifficulty[key] += 1;
  }
  return { exerciseCount: exercises.length, byType, byDifficulty };
}

function checkExerciseList(
  exercises: Exercise[],
  containerId: string,
  basePath: string,
  problems: ContentProblem[]
): void {
  const seenSentences = new Map<string, number>();
  const total = exercises.length;
  exercises.forEach((exercise, i) => {
    const path = `${basePath}.exercises[${i}]`;
    const before = problems.length;
    checkCommon(exercise, containerId, path, problems);
    checkByType(exercise, path, problems);

    const key = comparableSentence(exercise);
    if (key !== undefined) {
      const firstIndex = seenSentences.get(key);
      if (firstIndex !== undefined) {
        const firstId = exercises[firstIndex].id;
        problems.push({
          path,
          message: `duplicate target sentence "${key}" (already used by exercise ${firstIndex + 1}, id "${firstId}")`,
        });
      } else {
        seenSentences.set(key, i);
      }
    }

    // Stamp every problem raised for this exercise with its id and 1-based position, so
    // reports (scripts/content-report.ts) can lead with "<id> (exercise N of total): …" instead
    // of a raw "exercises[i]" array index (stage 4b report follow-up).
    for (let j = before; j < problems.length; j++) {
      problems[j].exerciseId = exercise.id;
      problems[j].exerciseNumber = i + 1;
      problems[j].exerciseCount = total;
    }
  });
}

/** Runs every content-quality rule over a validated Program and computes per-topic stats. */
export function checkContent(program: Program): ContentCheckResult {
  const problems: ContentProblem[] = [];
  const stats: Record<string, ContentStats> = {};
  const idFirstSeenAt = new Map<string, string>();

  function recordIds(exercises: Exercise[], basePath: string): void {
    const total = exercises.length;
    exercises.forEach((exercise, i) => {
      const path = `${basePath}.exercises[${i}].id`;
      const firstPath = idFirstSeenAt.get(exercise.id);
      if (firstPath !== undefined) {
        problems.push({
          path,
          message: `duplicate exercise id "${exercise.id}" (first used at ${firstPath})`,
          exerciseId: exercise.id,
          exerciseNumber: i + 1,
          exerciseCount: total,
        });
      } else {
        idFirstSeenAt.set(exercise.id, path);
      }
    });
  }

  for (const module of program.modules) {
    for (const topic of module.topics) {
      const basePath = `modules.${module.id}.topics.${topic.id}`;
      checkExerciseList(topic.exercises, topic.id, basePath, problems);
      recordIds(topic.exercises, basePath);
      stats[topic.id] = computeStats(topic.exercises);
    }
  }

  for (const phraseSet of program.phraseSets) {
    const basePath = `phraseSets.${phraseSet.id}`;
    checkExerciseList(phraseSet.exercises, phraseSet.id, basePath, problems);
    recordIds(phraseSet.exercises, basePath);
    stats[phraseSet.id] = computeStats(phraseSet.exercises);
  }

  return { problems, stats };
}
