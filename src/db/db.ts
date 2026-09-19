import Dexie, { type EntityTable } from 'dexie';
import type { Exercise, InputMode, Topic } from '../content/types';
import type { TopicProgress, TopicStatus } from '../engine/types';

export interface SettingsRow {
  key: string;
  value: unknown;
}

export interface ProfileRow {
  id: 'me';
  aboutMe: string;
  updatedAt: number;
}

// The shape itself lives in src/engine/types.ts so the engine needs no Dexie import.
export type { TopicStatus };
export type TopicProgressRow = TopicProgress;

export interface SessionRow {
  id: string;
  programId: string;
  startedAt: number;
  endedAt?: number;
  plannedLength: number;
  completed: number;
  correct: number;
  interrupted: boolean;
  /** Practice runs (retry mistakes / repeat session) never touch topic progress. */
  kind?: 'regular' | 'practice';
}

export interface AttemptRow {
  id: string;
  sessionId: string;
  exerciseId: string;
  topicId: string;
  mode: InputMode;
  correct: boolean;
  diacriticsOk?: boolean;
  answer: string;
  at: number;
  /** about_me exercises are graded by the learner in Stage 3 (no automatic check). */
  selfGraded?: boolean;
  /** Answered in a practice session, so it is excluded from progress and SRS. */
  practice?: boolean;
}

export interface CustomTopicRow {
  id: string;
  programId: string;
  topic: Topic;
  createdAt: number;
}

export interface GeneratedExerciseRow {
  id: string;
  topicId: string;
  exercise: Exercise;
  createdAt: number;
}

export class LangTrainerDB extends Dexie {
  settings!: EntityTable<SettingsRow, 'key'>;
  profile!: EntityTable<ProfileRow, 'id'>;
  topicProgress!: EntityTable<TopicProgressRow, 'topicId'>;
  sessions!: EntityTable<SessionRow, 'id'>;
  attempts!: EntityTable<AttemptRow, 'id'>;
  customTopics!: EntityTable<CustomTopicRow, 'id'>;
  generatedExercises!: EntityTable<GeneratedExerciseRow, 'id'>;

  constructor(name = 'langtrainer') {
    super(name);
    this.version(1).stores({
      settings: 'key',
      profile: 'id',
      topicProgress: 'topicId, programId, nextReviewAt',
      sessions: 'id, startedAt',
      attempts: 'id, sessionId, topicId, exerciseId',
      customTopics: 'id',
      generatedExercises: 'id, topicId',
    });

    // Stage 3 added TopicProgressRow.failedReviewsInARow (and the optional
    // AttemptRow.selfGraded, which needs no migration). Indexes are unchanged; the
    // stores() call is repeated so the version's schema is explicit.
    this.version(2)
      .stores({
        settings: 'key',
        profile: 'id',
        topicProgress: 'topicId, programId, nextReviewAt',
        sessions: 'id, startedAt',
        attempts: 'id, sessionId, topicId, exerciseId',
        customTopics: 'id',
        generatedExercises: 'id, topicId',
      })
      .upgrade((tx) =>
        tx
          .table<TopicProgressRow>('topicProgress')
          .toCollection()
          .modify((row) => {
            row.failedReviewsInARow ??= 0;
          })
      );

    // Stage 3b added TopicProgressRow.wrongExerciseIds (plus the optional
    // SessionRow.kind and AttemptRow.practice, which need no migration). Again no
    // index changes, so only the backfill is interesting.
    this.version(3)
      .stores({
        settings: 'key',
        profile: 'id',
        topicProgress: 'topicId, programId, nextReviewAt',
        sessions: 'id, startedAt',
        attempts: 'id, sessionId, topicId, exerciseId',
        customTopics: 'id',
        generatedExercises: 'id, topicId',
      })
      .upgrade((tx) =>
        tx
          .table<TopicProgressRow>('topicProgress')
          .toCollection()
          .modify((row) => {
            row.wrongExerciseIds ??= [];
          })
      );
  }
}

export const db = new LangTrainerDB();

/** All table names covered by backup export/import, in a stable order. */
export const BACKUP_TABLE_NAMES = [
  'settings',
  'profile',
  'topicProgress',
  'sessions',
  'attempts',
  'customTopics',
  'generatedExercises',
] as const;
