// Session planning (docs/stage-3-spec.md §2). Pure: no React, no Dexie; `now` and
// `rng` are always passed in.
import type { Exercise, InputMode, Program, Topic } from '../content/types';
import {
  DEFAULT_SESSION_MIX,
  normalizeMixShares,
  type InputShares,
  type SessionLength,
  type SessionMix,
  type SessionMixShares,
} from '../settings/settings';
import { RECENT_WINDOW_MS, SECURED_STREAK, type ExerciseHistory } from './history';
import { MIN_REVIEW_ATTEMPTS } from './progress';
import { pickWeighted, shuffle, type Rng } from './rng';
import type { TopicProgress } from './types';

/** `focus`: an item of a focus session on one chosen topic (docs/stage-6-spec.md §4). */
export type BlockKind = 'new' | 'review' | 'phrases' | 'focus';

/**
 * Regular sessions drive progress and the SRS; practice sessions (retry mistakes /
 * repeat session, docs/stage-3b-spec.md §4) are pure drill and change neither. Focus
 * sessions (one chosen topic, docs/stage-6-spec.md §4) record progress like regular ones
 * but never move the SRS.
 */
export type SessionKind = 'regular' | 'practice' | 'focus';

export interface PlannedItem {
  exercise: Exercise;
  mode: InputMode;
  block: BlockKind;
  topicId: string;
  /** First time this topic appears in the plan's new block: show the context screen. */
  showContextBefore?: boolean;
}

export interface SessionPlan {
  id: string;
  programId: string;
  /** Target number of exercises; `0` for an open-ended session. */
  plannedLength: number;
  open: boolean;
  items: PlannedItem[];
  kind: SessionKind;
  /** Practice plans built from the wrong answers only, so the summary can say "Fixed". */
  fromMistakes?: boolean;
  /** Focus sessions: the topic or phrase set being practised. */
  focusTopicId?: string;
}

export interface BlockCounts {
  new: number;
  review: number;
  phrases: number;
}

export interface PlanInput {
  program: Program;
  progress: TopicProgress[];
  sessionLength: SessionLength;
  inputShares: InputShares;
  /** New / review / phrases split; defaults to `balanced` (the fixed table). */
  sessionMix?: SessionMix;
  now: number;
  rng: Rng;
  /** Optional explicit session id (otherwise derived from `now` and `rng`). */
  id?: string;
  /**
   * Per-exercise answer history of the course (`buildExerciseHistory` over its attempts,
   * including those of the session being extended). Without it, seen exercises that
   * were not answered wrong last are picked at random.
   */
  history?: ReadonlyMap<string, ExerciseHistory>;
}

/** Fixed block composition per session length; each row sums to the length. */
export const BLOCK_COMPOSITION: Record<number, BlockCounts> = {
  5: { new: 3, review: 1, phrases: 1 },
  10: { new: 5, review: 3, phrases: 2 },
  15: { new: 8, review: 5, phrases: 2 },
  20: { new: 10, review: 7, phrases: 3 },
  30: { new: 15, review: 10, phrases: 5 },
};

/** An open session is planned in repeating cycles of six. */
export const OPEN_CYCLE: BlockCounts = { new: 3, review: 2, phrases: 1 };

/** Items in one open-session cycle. */
export const OPEN_CYCLE_LENGTH = 6;

const BLOCK_ORDER: readonly Exclude<BlockKind, 'focus'>[] = ['new', 'review', 'phrases'];

/**
 * Splits `total` items by percentage shares with largest-remainder rounding, so the
 * counts always sum to `total`. Ties go to the earlier block (new → review → phrases);
 * a zero share never receives an item.
 */
export function splitByShares(total: number, shares: SessionMixShares): BlockCounts {
  const normalized = normalizeMixShares(shares);
  const exact = BLOCK_ORDER.map((block) => (total * normalized[block]) / 100);
  const counts = exact.map(Math.floor);
  let remaining = total - counts.reduce((sum, n) => sum + n, 0);
  const byRemainder = BLOCK_ORDER.map((_, i) => i)
    .filter((i) => normalized[BLOCK_ORDER[i]] > 0)
    .sort((a, b) => exact[b] - counts[b] - (exact[a] - counts[a]) || a - b);
  for (const i of byRemainder) {
    if (remaining <= 0) break;
    counts[i] += 1;
    remaining -= 1;
  }
  return { new: counts[0], review: counts[1], phrases: counts[2] };
}

/**
 * Block sizes for a session (or, for `open`, for one cycle of six). `balanced` keeps the
 * hand-tuned BLOCK_COMPOSITION / OPEN_CYCLE tables exactly; every other preset (and
 * `custom`) splits the length by its shares.
 */
export function blockCountsFor(
  length: SessionLength,
  mix: SessionMix = DEFAULT_SESSION_MIX
): BlockCounts {
  if (mix.preset === 'balanced') {
    if (length === 'open') return { ...OPEN_CYCLE };
    return { ...(BLOCK_COMPOSITION[length] ?? BLOCK_COMPOSITION[10]) };
  }
  const total = length === 'open' ? OPEN_CYCLE_LENGTH : BLOCK_COMPOSITION[length] ? length : 10;
  return splitByShares(total, mix.shares);
}

const COMPLETED_STATUSES = new Set(['review', 'mastered', 'maintenance']);
const MODE_ORDER: InputMode[] = ['tiles', 'letters', 'typing'];
/**
 * A review block covers at most this many due topics, and the second one only when the
 * block has room for MIN_REVIEW_ATTEMPTS items for each (docs/stage-6-spec.md §1).
 */
const MAX_REVIEW_TOPICS = 2;

export function orderedTopics(program: Program): Topic[] {
  return program.modules.flatMap((module) => module.topics);
}

/** topicId -> exercises, for both topics and phrase sets. */
export function exercisesByTopic(program: Program): Map<string, Exercise[]> {
  const map = new Map<string, Exercise[]>();
  for (const topic of orderedTopics(program)) map.set(topic.id, topic.exercises);
  for (const set of program.phraseSets) map.set(set.id, set.exercises);
  return map;
}

/**
 * The topic the learner is working through: first in program order whose status is
 * `new` or `learning`. `undefined` once every topic has been completed at least once.
 */
export function currentTopicOf(program: Program, progress: TopicProgress[]): Topic | undefined {
  const byId = new Map(progress.map((row) => [row.topicId, row]));
  if (program.topicCompletionPolicy === 'all-exercises-correct') {
    return orderedTopics(program).find((topic) => {
      if (topic.exercises.length === 0) return false;
      const row = byId.get(topic.id);
      const seen = new Set(row?.seenExerciseIds ?? []);
      const allSeen = topic.exercises.every((exercise) => seen.has(exercise.id));
      // Only the new completion marker proves each item was answered correctly in a
      // regular test session. Legacy rows cannot distinguish that from practice fixes.
      const completed = allSeen && Boolean(row?.allExercisesCompletedAt);
      return !completed;
    });
  }
  return orderedTopics(program).find((topic) => {
    const status = byId.get(topic.id)?.status ?? 'new';
    return status === 'new' || status === 'learning';
  });
}

/**
 * Weighted random mode from `inputShares`; when the drawn mode is not allowed for the
 * exercise, fall back to the allowed mode with the highest share.
 */
export function pickMode(allowed: InputMode[], shares: InputShares, rng: Rng): InputMode {
  if (allowed.length === 0) return 'tiles';
  if (allowed.length === 1) return allowed[0];
  const drawn = pickWeighted(
    MODE_ORDER.map((mode) => ({ item: mode, weight: shares[mode] })),
    rng
  );
  if (drawn && allowed.includes(drawn)) return drawn;
  return [...allowed].sort(
    (a, b) => shares[b] - shares[a] || MODE_ORDER.indexOf(a) - MODE_ORDER.indexOf(b)
  )[0];
}

/**
 * Selection group of an exercise (lower comes first): 0 unseen, 1 last regular answer
 * wrong, 2 seen and not yet secured (correct streak < 2), 3 secured. Without a history
 * groups 2 and 3 are one group ("the rest", 2).
 */
function selectionGroup(
  id: string,
  seen: ReadonlySet<string>,
  wrong: ReadonlySet<string>,
  history: ReadonlyMap<string, ExerciseHistory> | undefined
): 0 | 1 | 2 | 3 {
  if (!seen.has(id)) return 0;
  if (wrong.has(id)) return 1;
  if (!history) return 2;
  return (history.get(id)?.correctStreak ?? 0) >= SECURED_STREAK ? 3 : 2;
}

/** Last time an exercise was answered; 0 (= longest ago) without a history entry. */
function lastSeenAt(id: string, history: ReadonlyMap<string, ExerciseHistory> | undefined) {
  return history?.get(id)?.lastSeenAt ?? 0;
}

function isRecent(
  id: string,
  history: ReadonlyMap<string, ExerciseHistory> | undefined,
  now: number
): boolean {
  const entry = history?.get(id);
  return entry !== undefined && now - entry.lastSeenAt < RECENT_WINDOW_MS;
}

interface PoolContext {
  seen: ReadonlySet<string>;
  wrong: ReadonlySet<string>;
  used: ReadonlySet<string>;
  history?: ReadonlyMap<string, ExerciseHistory>;
  now: number;
  rng: Rng;
}

/**
 * Selection order inside a topic (docs/engine.md "Exercise selection"):
 * (a) unseen, (b) last regular answer wrong, (c) seen, not yet secured (correct streak
 * < 2), (d) secured. (a) and (b) are sorted by difficulty in the new block and shuffled
 * elsewhere; (c) and (d) go least recently seen first, ties random. Inside every group an
 * exercise answered within the last 20 hours goes to the end.
 *
 * Without a `history` (c) and (d) are one shuffled group, exactly as before histories
 * existed.
 */
function orderedPool(
  exercises: readonly Exercise[],
  context: PoolContext,
  sortByDifficulty: boolean
): Exercise[] {
  const { seen, wrong, used, history, now, rng } = context;
  const groups: Exercise[][] = [[], [], [], []];
  for (const exercise of exercises) {
    if (used.has(exercise.id)) continue;
    groups[selectionGroup(exercise.id, seen, wrong, history)].push(exercise);
  }
  const arrange = (list: Exercise[]) =>
    sortByDifficulty ? [...list].sort((a, b) => a.difficulty - b.difficulty) : shuffle(list, rng);
  if (!history) return [...arrange(groups[0]), ...arrange(groups[1]), ...arrange(groups[2])];

  const recentLast = (list: Exercise[]) => [
    ...list.filter((exercise) => !isRecent(exercise.id, history, now)),
    ...list.filter((exercise) => isRecent(exercise.id, history, now)),
  ];
  // Shuffle first so the stable sort breaks equal timestamps at random. Sorting by
  // lastSeenAt already puts the last 20 hours at the end.
  const leastRecentFirst = (list: Exercise[]) =>
    shuffle(list, rng).sort((a, b) => lastSeenAt(a.id, history) - lastSeenAt(b.id, history));
  return [
    ...recentLast(arrange(groups[0])),
    ...recentLast(arrange(groups[1])),
    ...leastRecentFirst(groups[2]),
    ...leastRecentFirst(groups[3]),
  ];
}

interface Candidate {
  exercise: Exercise;
  topicId: string;
}

/** Round-robin over several topics so a review block spreads across them. */
function takeSpread(
  topicIds: string[],
  count: number,
  pools: Map<string, Exercise[]>
): Candidate[] {
  const picked: Candidate[] = [];
  let cursor = 0;
  while (picked.length < count && topicIds.some((id) => (pools.get(id)?.length ?? 0) > 0)) {
    const topicId = topicIds[cursor % topicIds.length];
    const exercise = pools.get(topicId)?.shift();
    if (exercise) picked.push({ exercise, topicId });
    cursor += 1;
  }
  return picked;
}

function seenSetFor(progress: TopicProgress[], topicId: string): Set<string> {
  const row = progress.find((entry) => entry.topicId === topicId);
  return new Set(row?.seenExerciseIds ?? []);
}

function wrongSetFor(progress: TopicProgress[], topicId: string): Set<string> {
  const row = progress.find((entry) => entry.topicId === topicId);
  return new Set(row?.wrongExerciseIds ?? []);
}

function poolContext(input: PlanInput, topicId: string, used: ReadonlySet<string>): PoolContext {
  return {
    seen: seenSetFor(input.progress, topicId),
    wrong: wrongSetFor(input.progress, topicId),
    used,
    history: input.history,
    now: input.now,
    rng: input.rng,
  };
}

interface BuildResult {
  items: PlannedItem[];
}

function buildItems(
  input: PlanInput,
  baseCounts: BlockCounts,
  used: Set<string>,
  contextShown: Set<string>,
  /** Items already planned in this session (open sessions), to count review items. */
  prior: readonly PlannedItem[] = []
): BuildResult {
  const { program, progress, rng } = input;
  const byTopic = exercisesByTopic(program);
  const current = currentTopicOf(program, progress);
  const counts: BlockCounts = { ...baseCounts };

  const poolFor = (topicId: string, sortByDifficulty: boolean) =>
    orderedPool(byTopic.get(topicId) ?? [], poolContext(input, topicId, used), sortByDifficulty);

  // --- review target and due topics ------------------------------------------
  // Everything completed: the new block becomes more review.
  let reviewTarget = counts.review + (current ? 0 : counts.new);

  // finishSession only moves a topic's SRS stage with >= MIN_REVIEW_ATTEMPTS review-block
  // attempts, so a due topic gets at least that many items (docs/stage-6-spec.md §1).
  // In an open session the review items already planned count towards it, so the same
  // topic is reviewed across cycles until it has enough, then the next due topic.
  const priorReview = new Map<string, number>();
  for (const item of prior) {
    if (item.block === 'review') {
      priorReview.set(item.topicId, (priorReview.get(item.topicId) ?? 0) + 1);
    }
  }
  const stillNeeded = (topicId: string) =>
    Math.max(0, MIN_REVIEW_ATTEMPTS - (priorReview.get(topicId) ?? 0));
  const dueTopicIds = progress
    .filter(
      (row) =>
        (row.status === 'review' || row.status === 'maintenance') &&
        row.nextReviewAt !== undefined &&
        row.nextReviewAt <= input.now &&
        byTopic.has(row.topicId) &&
        stillNeeded(row.topicId) > 0
    )
    .sort((a, b) => (a.nextReviewAt ?? 0) - (b.nextReviewAt ?? 0))
    .map((row) => row.topicId);

  let reviewTopicIds: string[] = [];
  // A review share of 0 is respected: no forced review. The gate is the *configured*
  // share, not the rounded block size: a small share can round to 0 items (custom
  // 90/10/0 at length 5 → 5/0/0), and due topics must still be reviewed then.
  const mix = input.sessionMix ?? DEFAULT_SESSION_MIX;
  const reviewShareConfigured =
    mix.preset === 'balanced' || normalizeMixShares(mix.shares).review > 0;
  if (dueTopicIds.length > 0 && (reviewShareConfigured || reviewTarget > 0)) {
    reviewTopicIds = dueTopicIds.slice(
      0,
      reviewTarget >= MAX_REVIEW_TOPICS * MIN_REVIEW_ATTEMPTS ? MAX_REVIEW_TOPICS : 1
    );
    const needed = reviewTopicIds.reduce((sum, id) => sum + stillNeeded(id), 0);
    // Too few review slots: borrow from the new block first, then from phrases, so the
    // total length stays the same.
    let deficit = Math.max(0, needed - reviewTarget);
    if (current && deficit > 0) {
      const fromNew = Math.min(deficit, counts.new);
      counts.new -= fromNew;
      counts.review += fromNew;
      reviewTarget += fromNew;
      deficit -= fromNew;
    }
    if (deficit > 0) {
      const fromPhrases = Math.min(deficit, counts.phrases);
      counts.phrases -= fromPhrases;
      counts.review += fromPhrases;
      reviewTarget += fromPhrases;
    }
  }

  // --- new block (current topic, easiest first) -------------------------------
  const newCandidates: Candidate[] = [];
  if (current) {
    const pool = poolFor(current.id, true);
    for (const exercise of pool.slice(0, counts.new)) {
      newCandidates.push({ exercise, topicId: current.id });
      used.add(exercise.id);
    }
  }

  // --- review block ----------------------------------------------------------
  if (reviewTopicIds.length === 0) {
    const completed = progress
      .filter((row) => COMPLETED_STATUSES.has(row.status) && byTopic.has(row.topicId))
      .map((row) => row.topicId);
    if (completed.length > 0) {
      reviewTopicIds = [completed[Math.floor(rng() * completed.length)]];
    } else if (current) {
      // Nothing completed yet: fill with more current-topic exercises.
      reviewTopicIds = [current.id];
    }
  }
  const reviewPools = new Map(reviewTopicIds.map((id) => [id, poolFor(id, false)]));
  const reviewCandidates = takeSpread(reviewTopicIds, reviewTarget, reviewPools);
  for (const candidate of reviewCandidates) used.add(candidate.exercise.id);

  // --- phrases block ---------------------------------------------------------
  const phraseCandidates: Candidate[] = [];
  const phrasePool: Candidate[] = [];
  for (const set of program.phraseSets) {
    for (const exercise of poolFor(set.id, false)) {
      phrasePool.push({ exercise, topicId: set.id });
    }
  }
  // The topic order across sets: unseen first, then past mistakes, keeping phraseSet
  // order inside those groups; with a history, then not-yet-secured and secured phrases,
  // each least recently seen first across all sets, the last 20 hours at the end.
  const { history, now } = input;
  const phraseKeys = new Map<Candidate, [number, number, number]>();
  for (const candidate of phrasePool) {
    const id = candidate.exercise.id;
    const group = selectionGroup(
      id,
      seenSetFor(progress, candidate.topicId),
      wrongSetFor(progress, candidate.topicId),
      history
    );
    phraseKeys.set(candidate, [
      group,
      isRecent(id, history, now) ? 1 : 0,
      group >= 2 ? lastSeenAt(id, history) : 0,
    ]);
  }
  phrasePool.sort((a, b) => {
    const ka = phraseKeys.get(a) ?? [0, 0, 0];
    const kb = phraseKeys.get(b) ?? [0, 0, 0];
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2];
  });
  for (const candidate of phrasePool.slice(0, counts.phrases)) {
    phraseCandidates.push(candidate);
    used.add(candidate.exercise.id);
  }

  // --- top up short blocks so the session still reaches its target -----------
  const target = counts.new + counts.review + counts.phrases;
  const picked = [
    ...newCandidates.map((c) => ({ ...c, block: 'new' as BlockKind })),
    ...reviewCandidates.map((c) => ({ ...c, block: 'review' as BlockKind })),
    ...phraseCandidates.map((c) => ({ ...c, block: 'phrases' as BlockKind })),
  ];
  if (picked.length < target) {
    const fillerTopicIds = [
      ...(current ? [current.id] : []),
      ...reviewTopicIds,
      ...program.phraseSets.map((set) => set.id),
    ];
    for (const topicId of fillerTopicIds) {
      if (picked.length >= target) break;
      const block: BlockKind = program.phraseSets.some((set) => set.id === topicId)
        ? 'phrases'
        : current && topicId === current.id
          ? 'new'
          : 'review';
      for (const exercise of poolFor(topicId, false)) {
        if (picked.length >= target) break;
        used.add(exercise.id);
        picked.push({ exercise, topicId, block });
      }
    }
    // Keep block order (new → review → phrases) after topping up.
    const blockRank: Record<BlockKind, number> = { new: 0, review: 1, phrases: 2, focus: 3 };
    picked.sort((a, b) => blockRank[a.block] - blockRank[b.block]);
  }

  const items: PlannedItem[] = picked.map((candidate) => {
    const item: PlannedItem = {
      exercise: candidate.exercise,
      mode: pickMode(candidate.exercise.allowedModes, input.inputShares, rng),
      block: candidate.block,
      topicId: candidate.topicId,
    };
    if (candidate.block === 'new' && !contextShown.has(candidate.topicId)) {
      contextShown.add(candidate.topicId);
      item.showContextBefore = true;
    }
    return item;
  });

  return { items };
}

export function planSession(input: PlanInput): SessionPlan {
  if (input.program.topicCompletionPolicy === 'all-exercises-correct') {
    const topic = currentTopicOf(input.program, input.progress);
    if (topic) {
      const row = input.progress.find((entry) => entry.topicId === topic.id);
      const seen = new Set(row?.seenExerciseIds ?? []);
      const wrong = new Set(row?.wrongExerciseIds ?? []);
      const legacyCompletedWithoutProof =
        row &&
        COMPLETED_STATUSES.has(row.status) &&
        !row.allExercisesCompletedAt &&
        topic.exercises.every((exercise) => seen.has(exercise.id));
      const exercises = orderedPool(
        topic.exercises,
        poolContext(input, topic.id, new Set()),
        false
      ).filter(
        (exercise) =>
          legacyCompletedWithoutProof || !seen.has(exercise.id) || wrong.has(exercise.id)
      );
      const items = exercises.map((exercise, index) => {
        const item: PlannedItem = {
          exercise,
          mode: pickMode(exercise.allowedModes, input.inputShares, input.rng),
          block: 'new',
          topicId: topic.id,
        };
        if (index === 0) item.showContextBefore = true;
        return item;
      });
      return {
        id: input.id ?? `s${input.now.toString(36)}-${Math.floor(input.rng() * 0xffffff).toString(36)}`,
        programId: input.program.id,
        plannedLength: items.length,
        open: false,
        items,
        kind: 'regular',
      };
    }
  }

  const open = input.sessionLength === 'open';
  const counts = blockCountsFor(input.sessionLength, input.sessionMix);
  const { items } = buildItems(input, counts, new Set(), new Set());
  return {
    id: input.id ?? `s${input.now.toString(36)}-${Math.floor(input.rng() * 0xffffff).toString(36)}`,
    programId: input.program.id,
    // 0 marks an open session; otherwise the real length, which can be below the target
    // when the program runs out of exercises (so the UI never promises "1/10" of 3).
    plannedLength: open ? 0 : items.length,
    open,
    items,
    kind: 'regular',
  };
}

/**
 * A practice run over exercises the learner has just answered (docs/stage-3b-spec.md §4):
 * same exercises, same input modes, no context screens, and no effect on topic progress
 * or the SRS — the runner records the attempts with `practice: true` instead.
 */
export function planPractice(
  items: readonly PlannedItem[],
  options: { id: string; programId: string; fromMistakes?: boolean }
): SessionPlan {
  return {
    id: options.id,
    programId: options.programId,
    plannedLength: items.length,
    open: false,
    kind: 'practice',
    ...(options.fromMistakes ? { fromMistakes: true } : {}),
    items: items.map(({ showContextBefore: _skip, ...item }) => ({ ...item })),
  };
}

/**
 * Focus items from one topic or phrase set in the usual selection order (`orderedPool`),
 * skipping `used`.
 */
function focusItems(
  input: PlanInput,
  topicId: string,
  count: number,
  used: ReadonlySet<string>,
  withContext: boolean
): PlannedItem[] {
  const { program, rng } = input;
  const topic = orderedTopics(program).find((candidate) => candidate.id === topicId);
  const exercises = exercisesByTopic(program).get(topicId) ?? [];
  let pool = orderedPool(exercises, poolContext(input, topicId, used), false);
  if (
    program.topicCompletionPolicy === 'all-exercises-correct' &&
    currentTopicOf(program, input.progress)?.id === topicId
  ) {
    const row = input.progress.find((entry) => entry.topicId === topicId);
    const seen = new Set(row?.seenExerciseIds ?? []);
    const wrong = new Set(row?.wrongExerciseIds ?? []);
    pool = pool.filter((exercise) => !seen.has(exercise.id) || wrong.has(exercise.id));
  } else {
    pool = pool.slice(0, count);
  }
  return pool.map((exercise, i) => {
    const item: PlannedItem = {
      exercise,
      mode: pickMode(exercise.allowedModes, input.inputShares, rng),
      block: 'focus',
      topicId,
    };
    // Topics get their context screen first; phrase sets have none.
    if (i === 0 && withContext && topic) item.showContextBefore = true;
    return item;
  });
}

/**
 * A focus session on one topic or phrase set (docs/stage-6-spec.md §4): every item comes
 * from it, never repeating an exercise; the length is the learner's `sessionLength`
 * (fewer when the topic runs out). An open session plans cycles of six from the same
 * topic until its pool is exhausted (see `planNextCycle`).
 */
export function planFocus(input: PlanInput, topicId: string): SessionPlan {
  const isCompletingTopic =
    input.program.topicCompletionPolicy === 'all-exercises-correct' &&
    currentTopicOf(input.program, input.progress)?.id === topicId;
  const open = input.sessionLength === 'open' && !isCompletingTopic;
  const count = input.sessionLength === 'open' ? OPEN_CYCLE_LENGTH : input.sessionLength;
  const items = focusItems(input, topicId, count, new Set(), true);
  return {
    id: input.id ?? `f${input.now.toString(36)}-${Math.floor(input.rng() * 0xffffff).toString(36)}`,
    programId: input.program.id,
    plannedLength: open ? 0 : items.length,
    open,
    items,
    kind: 'focus',
    focusTopicId: topicId,
  };
}

/**
 * Appends one more cycle of six to an open-ended plan, never repeating an exercise:
 * split by the session mix for a regular plan, from the same topic for a focus plan
 * (nothing is appended once that topic is exhausted, which ends the session).
 */
export function planNextCycle(plan: SessionPlan, input: PlanInput): SessionPlan {
  if (plan.kind === 'focus' && plan.focusTopicId) {
    const used = new Set(plan.items.map((item) => item.exercise.id));
    const items = focusItems(input, plan.focusTopicId, OPEN_CYCLE_LENGTH, used, false);
    return { ...plan, items: [...plan.items, ...items] };
  }
  const used = new Set(plan.items.map((item) => item.exercise.id));
  const contextShown = new Set(
    plan.items.filter((item) => item.showContextBefore).map((item) => item.topicId)
  );
  const { items } = buildItems(
    input,
    blockCountsFor('open', input.sessionMix),
    used,
    contextShown,
    plan.items
  );
  return { ...plan, items: [...plan.items, ...items] };
}
