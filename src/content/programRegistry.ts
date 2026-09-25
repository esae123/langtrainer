// The registry of installed courses (docs/stage-4a-spec.md §1). A course ("program") is
// either **bundled** — authored in `content/`, built into `src/content/programs` and
// shipped with the app — or **imported** from a JSON file and stored in the `programs`
// Dexie table on this device.
//
// Bundled ids always win: an import that reuses one is rejected, so the merged list can
// never contain two entries with the same id.
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { db, type ProgramRow } from '../db/db';
import { isRecord } from '../lib/isRecord';
import { clearActiveSession, readActiveSession } from '../session/activeSession';
import { loadSettings, updateSettings, useSettings } from '../settings/settingsStore';
import { programs as bundledPrograms } from './programs';
import type { Program } from './types';

export type ProgramSource = 'bundled' | 'imported';

export interface ProgramEntry {
  program: Program;
  source: ProgramSource;
  /** Imported courses only. */
  importedAt?: number;
  fileName?: string;
}

export const bundledEntries: ProgramEntry[] = bundledPrograms.map((program) => ({
  program,
  source: 'bundled',
}));

export function isBundledProgramId(id: string): boolean {
  return bundledPrograms.some((program) => program.id === id);
}

/** The bundled program with this id, available synchronously (no Dexie round-trip). */
export function getProgramSync(id: string): Program | undefined {
  return bundledPrograms.find((program) => program.id === id);
}

/**
 * Guards against a stored row whose `program` is not usable at all (a hand-edited
 * backup, say). Imported programs were fully validated when they were imported, so
 * this is only a crash guard, not a re-validation.
 */
function usableProgram(value: unknown): Program | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.title !== 'string') return null;
  if (!Array.isArray(value.modules) || !Array.isArray(value.phraseSets)) return null;
  return value as unknown as Program;
}

function toEntry(row: ProgramRow): ProgramEntry | null {
  const program = usableProgram(row.program);
  if (!program || isBundledProgramId(program.id)) return null;
  return {
    program,
    source: 'imported',
    importedAt: row.importedAt,
    ...(row.fileName !== undefined ? { fileName: row.fileName } : {}),
  };
}

/** Imported courses, oldest import first. Never throws on a damaged row — it skips it. */
export async function loadImportedEntries(): Promise<ProgramEntry[]> {
  const rows = await db.programs.toArray();
  return rows
    .map(toEntry)
    .filter((entry): entry is ProgramEntry => entry !== null)
    .sort((a, b) => (a.importedAt ?? 0) - (b.importedAt ?? 0));
}

export async function loadAllEntries(): Promise<ProgramEntry[]> {
  return [...bundledEntries, ...(await loadImportedEntries())];
}

/**
 * Every installed course, live — or `undefined` until the imported courses have been
 * read. Returning only the bundled ones in the meantime would make every consumer
 * resolve the active course to the bundled fallback for a render, and the session
 * runner (which plans exactly once) would then plan the wrong course.
 */
export function useAllPrograms(): ProgramEntry[] | undefined {
  const imported = useLiveQuery(loadImportedEntries, []);
  return useMemo(() => (imported ? [...bundledEntries, ...imported] : undefined), [imported]);
}

/** `undefined` while loading and when no installed course has this id. */
export function useProgram(id: string): Program | undefined {
  const entries = useAllPrograms();
  return entries?.find((entry) => entry.program.id === id)?.program;
}

/**
 * The entry `activeProgramId` points at, or — when it points at a course that was
 * removed (or never existed on this device) — the first bundled one.
 */
export function resolveActiveEntry(
  entries: readonly ProgramEntry[],
  activeProgramId: string
): ProgramEntry | undefined {
  return (
    entries.find((entry) => entry.program.id === activeProgramId) ??
    entries.find((entry) => entry.source === 'bundled') ??
    entries[0]
  );
}

/**
 * The active course entry (with its bundled/imported source), live. `undefined` while
 * the installed courses are still loading — callers must wait instead of falling back.
 */
export function useActiveProgramEntry(): ProgramEntry | undefined {
  const { activeProgramId } = useSettings();
  const entries = useAllPrograms();
  return entries ? resolveActiveEntry(entries, activeProgramId) : undefined;
}

/** The active course, live (`undefined` while loading). Used by Learn, the session runner and the library. */
export function useActiveProgram(): Program | undefined {
  return useActiveProgramEntry()?.program;
}

export async function setActiveProgram(id: string): Promise<void> {
  await updateSettings({ activeProgramId: id });
}

/** Adds (or replaces) an imported course. Progress rows are keyed by topic id, so a replacement keeps them. */
export async function putImportedProgram(program: Program, fileName?: string): Promise<void> {
  await db.programs.put({
    id: program.id,
    program,
    source: 'imported',
    importedAt: Date.now(),
    ...(fileName !== undefined ? { fileName } : {}),
  });
}

/**
 * Removes an imported course. A saved in-progress session of that course is always
 * dropped (it could never be resumed). `deleteProgress` also drops everything recorded
 * for it: topic progress, session rows, the attempts of those sessions and the learner's
 * custom topics of that course.
 */
export async function removeImportedProgram(
  programId: string,
  deleteProgress: boolean
): Promise<void> {
  await db.transaction(
    'rw',
    [db.programs, db.settings, db.topicProgress, db.sessions, db.attempts, db.customTopics],
    async () => {
      await db.programs.delete(programId);
      const saved = await readActiveSession();
      if (saved && saved.state.programId === programId) await clearActiveSession();
      if (!deleteProgress) return;
      await db.topicProgress.where('programId').equals(programId).delete();
      await db.customTopics.filter((row) => row.programId === programId).delete();
      const sessionIds = (
        await db.sessions.filter((row) => row.programId === programId).toArray()
      ).map((row) => row.id);
      if (sessionIds.length > 0) {
        await db.attempts.where('sessionId').anyOf(sessionIds).delete();
        await db.sessions.bulkDelete(sessionIds);
      }
    }
  );

  // Never leave `activeProgramId` pointing at a course that is gone.
  const settings = await loadSettings();
  if (settings.activeProgramId === programId) {
    const fallback = resolveActiveEntry(await loadAllEntries(), programId);
    if (fallback) await setActiveProgram(fallback.program.id);
  }
}

export interface ProgramCounts {
  modules: number;
  topics: number;
  exercises: number;
}

/** Module / topic / exercise counts of a course, for the cards and the switcher. */
export function programCounts(program: Program): ProgramCounts {
  const topics = program.modules.flatMap((module) => module.topics);
  return {
    modules: program.modules.length,
    topics: topics.length,
    exercises:
      topics.reduce((sum, topic) => sum + topic.exercises.length, 0) +
      program.phraseSets.reduce((sum, set) => sum + set.exercises.length, 0),
  };
}

/** Every topic and phrase-set id of a course — the ids that must be unique across courses. */
export function contentIdsOf(program: Program): string[] {
  return [
    ...program.modules.flatMap((module) => module.topics.map((topic) => topic.id)),
    ...program.phraseSets.map((set) => set.id),
  ];
}
