import { useId, useState } from 'react';
import { Share2, Trash2 } from 'lucide-react';
import { Sheet } from '../components/Sheet';
import { useToast } from '../components/toastStore';
import { courseFileName } from '../content/importProgram';
import { removeImportedProgram, type ProgramEntry } from '../content/programRegistry';
import { useT } from '../i18n';
import { shareOrDownloadFile } from '../lib/shareFile';

/**
 * Export / remove for an imported course (docs/stage-4a-spec.md §3), shown in the
 * course header on the Library screen. Removing asks first and only deletes progress
 * when the learner ticks the box.
 */
export function CourseActions({ entry }: { entry: ProgramEntry }) {
  const t = useT();
  const showToast = useToast();
  const titleId = useId();
  const checkboxId = useId();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [alsoProgress, setAlsoProgress] = useState(false);

  async function exportCourse() {
    try {
      const json = JSON.stringify(entry.program, null, 2);
      const outcome = await shareOrDownloadFile(json, courseFileName(entry.program.id));
      if (outcome !== 'cancelled') showToast(t('courses.exported'));
    } catch {
      showToast(t('courses.exportError'));
    }
  }

  async function remove() {
    setConfirmOpen(false);
    try {
      await removeImportedProgram(entry.program.id, alsoProgress);
      showToast(t('courses.removed'));
    } catch {
      showToast(t('courses.removeError'));
    } finally {
      setAlsoProgress(false);
    }
  }

  return (
    <>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void exportCourse()}
          className="flex min-h-11 items-center gap-2 rounded-lg border border-line px-3 text-sm font-medium text-text"
        >
          <Share2 size={18} strokeWidth={2} aria-hidden />
          {t('courses.export')}
        </button>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          className="flex min-h-11 items-center gap-2 rounded-lg border border-line px-3 text-sm font-medium text-bad"
        >
          <Trash2 size={18} strokeWidth={2} aria-hidden />
          {t('courses.remove')}
        </button>
      </div>

      <Sheet open={confirmOpen} onClose={() => setConfirmOpen(false)} titleId={titleId}>
        <h2 id={titleId} className="text-lg font-semibold text-text">
          {t('courses.removeTitle', { title: entry.program.title })}
        </h2>
        <p className="mt-2 text-sm text-muted">{t('courses.removeBody')}</p>
        <label
          htmlFor={checkboxId}
          className="mt-3 flex min-h-11 items-center gap-3 text-sm text-text"
        >
          <input
            id={checkboxId}
            type="checkbox"
            checked={alsoProgress}
            onChange={(event) => setAlsoProgress(event.target.checked)}
            className="size-5 accent-accent"
          />
          {t('courses.removeProgress')}
        </label>
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={() => setConfirmOpen(false)}
            className="min-h-11 flex-1 rounded-xl border border-line text-sm font-medium text-text"
          >
            {t('courses.removeCancel')}
          </button>
          <button
            type="button"
            onClick={() => void remove()}
            className="min-h-11 flex-1 rounded-xl bg-bad text-sm font-semibold text-paper"
          >
            {t('courses.removeOk')}
          </button>
        </div>
      </Sheet>
    </>
  );
}
