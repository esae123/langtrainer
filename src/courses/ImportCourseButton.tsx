import { useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/toastStore';
import {
  readAndCheckCourseFile,
  type CourseProblem,
  type InstalledCourse,
} from '../content/importProgram';
import {
  contentIdsOf,
  loadAllEntries,
  putImportedProgram,
  setActiveProgram,
} from '../content/programRegistry';
import type { Program } from '../content/types';
import { useT } from '../i18n';
import { CourseProblemsSheet } from './CourseProblemsSheet';

interface PendingReplace {
  program: Program;
  fileName: string;
  title: string;
}

/**
 * "Import course" — the whole flow of docs/stage-4a-spec.md §3 behind one button:
 * file picker → validate → problems sheet or replace confirmation → install and
 * activate. The trigger's look is up to the caller (`children` + `className`), so the
 * Learn switcher row and the Settings row can share it.
 */
export function ImportCourseButton({
  children,
  className,
  onImported,
}: {
  children: ReactNode;
  className?: string;
  onImported?: () => void;
}) {
  const t = useT();
  const showToast = useToast();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [problems, setProblems] = useState<CourseProblem[] | null>(null);
  const [pending, setPending] = useState<PendingReplace | null>(null);

  /** Read when the file is picked, not on render, so the check never sees a stale list. */
  async function installedCourses(): Promise<InstalledCourse[]> {
    return (await loadAllEntries()).map((entry) => ({
      id: entry.program.id,
      title: entry.program.title,
      source: entry.source,
      contentIds: contentIdsOf(entry.program),
    }));
  }

  async function install(program: Program, fileName: string) {
    await putImportedProgram(program, fileName);
    await setActiveProgram(program.id);
    showToast(t('courses.imported'));
    onImported?.();
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Clearing the input lets the same file be picked again after a failed attempt.
    event.target.value = '';
    if (!file) return;

    const result = await readAndCheckCourseFile(file, await installedCourses());
    if (!result.ok) {
      setProblems(result.problems);
      return;
    }
    if (result.replacesImported) {
      setPending({ program: result.program, fileName: file.name, title: result.program.title });
      return;
    }
    await install(result.program, file.name);
  }

  return (
    <>
      <button type="button" onClick={() => inputRef.current?.click()} className={className}>
        {children}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        onChange={(event) => void handleFile(event)}
        className="hidden"
        data-testid="course-file-input"
      />

      <CourseProblemsSheet problems={problems} onClose={() => setProblems(null)} />

      <ConfirmDialog
        open={pending !== null}
        title={t('courses.replaceTitle', { title: pending?.title ?? '' })}
        body={t('courses.replaceBody')}
        confirmLabel={t('courses.replaceOk')}
        cancelLabel={t('courses.replaceCancel')}
        onConfirm={() => {
          const next = pending;
          setPending(null);
          if (next) void install(next.program, next.fileName);
        }}
        onCancel={() => setPending(null)}
      />
    </>
  );
}
