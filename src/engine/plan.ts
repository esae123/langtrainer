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
import { pickWeighted, shuffle, type Rng } from './rng';
import type { TopicProgress } from './types';

export type BlockKind = 'new' | 'review' | 'phrases';

/**
 * Regular sessions drive progress and the SRS; practice sessions (retry mistakes /
 * repeat session, docs/stage-3b-spec.md §4) are pure drill and change neither.
 */
export type SessionKind = 'regular' | 'practice';

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

const BLOCK_ORDER: readonly BlockKind[] = ['new', 'review', 'phrases'];

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
/** Due topics are spread over at most this many topics per review block. */
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
 * Selection order inside a topic (docs/stage-3b-spec.md §5): unseen exercises first,
 * then the ones whose last regular attempt was wrong, then the rest. The new block is
 * sorted by difficulty ascending inside each group, elsewhere each group is shuffled.
 */
function orderedPool(
  exercises: readonly Exercise[],
  seen: ReadonlySet<string>,
  wrong: ReadonlySet<string>,
  used: ReadonlySet<string>,
  rng: Rng,
  sortByDifficulty: boolean
): Exercise[] {
  const available = exercises.filter((exercise) => !used.has(exercise.id));
  const unseen = available.filter((exercise) => !seen.has(exercise.id));
  const wrongBefore = available.filter(
    (exercise) => seen.has(exercise.id) && wrong.has(exercise.id)
  );
  const rest = available.filter((exercise) => seen.has(exercise.id) && !wrong.has(exercise.id));
  const arrange = (list: Exercise[]) =>
    sortByDifficulty
      ? [...list].sort((a, b) => a.difficulty - b.difficulty)
      : // No per-exercise timestamps are kept, so "least recently seen" is random.
        shuffle(list, rng);
  return [...arrange(unseen), ...arrange(wrongBefore), ...arrange(rest)];
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

interface BuildResult {
  items: PlannedItem[];
}

function buildItems(
  input: PlanInput,
  counts: BlockCounts,
  used: Set<string>,
  contextShown: Set<string>
): BuildResult {
  const { program, progress, rng } = input;
  const byTopic = exercisesByTopic(program);
  const current = currentTopicOf(program, progress);

  const poolFor = (topicId: string, sortByDifficulty: boolean) =>
    orderedPool(
      byTopic.get(topicId) ?? [],
      seenSetFor(progress, topicId),
      wrongSetFor(progress, topicId),
      used,
      rng,
      sortByDifficulty
    );

  // --- new block (current topic, easiest first) -------------------------------
  const newCandidates: Candidate[] = [];
  let reviewTarget = counts.review;
  if (current) {
    const pool = poolFor(current.id, true);
    for (const exercise of pool.slice(0, counts.new)) {
      newCandidates.push({ exercise, topicId: current.id });
      used.add(exercise.id);
    }
  } else {
    // Everything completed: the new block becomes more review.
    reviewTarget += counts.new;
  }

  // --- review block ----------------------------------------------------------
  const dueTopicIds = progress
    .filter(
      (row) =>
        (row.status === 'review' || row.status === 'maintenance') &&
        row.nextReviewAt !== undefined &&
        row.nextReviewAt <= input.now &&
        byTopic.has(row.topicId)
    )
    .sort((a, b) => (a.nextReviewAt ?? 0) - (b.nextReviewAt ?? 0))
    .slice(0, MAX_REVIEW_TOPICS)
    .map((row) => row.topicId);

  let reviewTopicIds = dueTopicIds;
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
  // Unseen first across sets, then past mistakes, keeping phraseSet order inside a group.
  const phraseRank = (candidate: Candidate) => {
    if (!seenSetFor(progress, candidate.topicId).has(candidate.exercise.id)) return 0;
    return wrongSetFor(progress, candidate.topicId).has(candidate.exercise.id) ? 1 : 2;
  };
  phrasePool.sort((a, b) => phraseRank(a) - phraseRank(b));
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
    const blockRank: Record<BlockKind, number> = { new: 0, review: 1, phrases: 2 };
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
 * Appends one more cycle of six (split by the session mix) to an open-ended plan, never
 * repeating an exercise.
 */
export function planNextCycle(plan: SessionPlan, input: PlanInput): SessionPlan {
  const used = new Set(plan.items.map((item) => item.exercise.id));
  const contextShown = new Set(
    plan.items.filter((item) => item.showContextBefore).map((item) => item.topicId)
  );
  const { items } = buildItems(input, blockCountsFor('open', input.sessionMix), used, contextShown);
  return { ...plan, items: [...plan.items, ...items] };
}
