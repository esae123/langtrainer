import { useId } from 'react';
import { Copy, TriangleAlert } from 'lucide-react';
import { Sheet } from '../components/Sheet';
import { useToast } from '../components/toastStore';
import { formatCourseProblems, type CourseProblem } from '../content/importProgram';
import { useT, type TranslationKey } from '../i18n';

/** Only the first few problems are worth reading on a phone; "Copy all" has the rest. */
const MAX_SHOWN = 10;

/**
 * Why a course file was rejected (docs/stage-4a-spec.md §3). Problems the app authors
 * itself are translated; validator and content-rule diagnostics are shown as they come
 * (English, exactly like `npm run content:check`), which is also what is copied.
 */
export function CourseProblemsSheet({
  problems,
  onClose,
}: {
  problems: CourseProblem[] | null;
  onClose: () => void;
}) {
  const t = useT();
  const showToast = useToast();
  const titleId = useId();
  const all = problems ?? [];
  const shown = all.slice(0, MAX_SHOWN);

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(formatCourseProblems(all));
      showToast(t('courses.copied'));
    } catch {
      showToast(t('courses.copyFailed'));
    }
  }

  return (
    <Sheet open={problems !== null} onClose={onClose} titleId={titleId}>
      <h2 id={titleId} className="flex items-center gap-2 text-lg font-semibold text-text">
        <TriangleAlert size={20} strokeWidth={2} aria-hidden className="text-bad" />
        {t('courses.problemsTitle')}
      </h2>
      <p className="mt-2 text-sm text-muted">
        {t('courses.problemsBody', { count: all.length, shown: shown.length })}
      </p>
      <ol className="mt-3 max-h-[45vh] divide-y divide-line overflow-y-auto rounded-xl border border-line">
        {shown.map((problem, i) => (
          <li key={`${problem.path}-${i}`} className="px-3 py-2">
            <p className="break-all font-mono text-xs text-muted">{problem.path}</p>
            <p className="text-sm text-text">
              {problem.code
                ? t(`courses.problem.${problem.code}` as TranslationKey, problem.vars)
                : problem.message}
            </p>
          </li>
        ))}
      </ol>
      <div className="mt-5 flex gap-3">
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 flex-1 rounded-xl border border-line text-sm font-medium text-text"
        >
          {t('courses.close')}
        </button>
        <button
          type="button"
          onClick={() => void copyAll()}
          className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-accent text-sm font-semibold text-accent-ink"
        >
          <Copy size={18} strokeWidth={2} aria-hidden />
          {t('courses.copyAll')}
        </button>
      </div>
    </Sheet>
  );
}
