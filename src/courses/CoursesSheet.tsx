import { useId } from 'react';
import { Check, Upload } from 'lucide-react';
import { Sheet } from '../components/Sheet';
import { resolveActiveEntry, setActiveProgram, useAllPrograms } from '../content/programRegistry';
import { useT } from '../i18n';
import { useSettings } from '../settings/settingsStore';
import { CourseCountsLine, CourseProgressLine, CourseSourceBadge } from './CourseMeta';
import { ImportCourseButton } from './ImportCourseButton';
import { ImportHelpButton } from './ImportHelp';

/**
 * The course switcher (docs/stage-4a-spec.md §2): every installed course with its level,
 * target language, size and progress; tapping one makes it active. The last row starts
 * the import flow. Switching never discards a saved session — only the *next* session
 * is planned from the newly active course.
 */
export function CoursesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const titleId = useId();
  const settings = useSettings();
  const entries = useAllPrograms() ?? [];
  // The *resolved* active course, so a stale `activeProgramId` still marks the one in use.
  const activeId = resolveActiveEntry(entries, settings.activeProgramId)?.program.id;

  return (
    <Sheet open={open} onClose={onClose} titleId={titleId}>
      <h2 id={titleId} className="text-lg font-semibold text-text">
        {t('courses.title')}
      </h2>

      <ul className="mt-3 flex max-h-[55vh] flex-col gap-2 overflow-y-auto">
        {entries.map((entry) => {
          const active = entry.program.id === activeId;
          return (
            <li key={entry.program.id}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => {
                  void setActiveProgram(entry.program.id);
                  onClose();
                }}
                className={`flex min-h-11 w-full flex-col items-start gap-0.5 rounded-xl border px-3 py-2 text-left ${
                  active ? 'border-accent bg-accent-soft' : 'border-line'
                }`}
              >
                <span className="flex w-full items-center gap-2">
                  <span className="text-sm font-semibold text-text">{entry.program.title}</span>
                  {active && (
                    <Check size={16} strokeWidth={2.5} aria-hidden className="text-accent" />
                  )}
                  <span className="ml-auto flex items-center gap-2">
                    <CourseSourceBadge entry={entry} />
                  </span>
                </span>
                <CourseCountsLine entry={entry} />
                <CourseProgressLine entry={entry} />
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex items-center gap-1 border-t border-line pt-3">
        <ImportCourseButton
          onImported={onClose}
          className="flex min-h-11 flex-1 items-center gap-2 rounded-xl px-3 text-left text-sm font-semibold text-accent"
        >
          <Upload size={18} strokeWidth={2} aria-hidden />
          {t('courses.importFromFile')}
        </ImportCourseButton>
        <ImportHelpButton />
      </div>

      <button
        type="button"
        onClick={onClose}
        className="mt-3 min-h-11 w-full rounded-xl border border-line text-sm font-medium text-text"
      >
        {t('courses.close')}
      </button>
    </Sheet>
  );
}
