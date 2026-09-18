import Dexie, { type EntityTable } from 'dexie';
import type { Exercise, InputMode, Topic } from '../content/types';

export interface SettingsRow {
  key: string;
  value: unknown;
}

export interface ProfileRow {
  id: 'me';
  aboutMe: string;
  updatedAt: number;
}

export type TopicStatus = 'new' | 'learning' | 'review' | 'mastered' | 'maintenance';

export interface TopicProgressRow {
  topicId: string;
  programId: string;
  status: TopicStatus;
  firstCompletedAt?: number;
  lastReviewedAt?: number;
  nextReviewAt?: number;
  reviewStage: 0 | 1 | 2 | 3;
  history: { at: number; correct: number; total: number }[];
  seenExerciseIds: string[];
}

export interface SessionRow {
  id: string;
  programId: string;
  startedAt: number;
  endedAt?: number;
  plannedLength: number;
  completed: number;
  correct: number;
  interrupted: boolean;
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
