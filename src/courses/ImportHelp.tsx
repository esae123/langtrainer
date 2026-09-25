import { useId, useState } from 'react';
import { CircleHelp } from 'lucide-react';
import { Sheet } from '../components/Sheet';
import { useT } from '../i18n';

/**
 * Smallest valid course file: one module, one topic, one exercise. Kept in sync with the
 * validator by a test, so the reminder can never show a shape the importer rejects.
 */
export const COURSE_FILE_EXAMPLE = `{
  "id": "en-b2",
  "title": "English B2",
  "targetLanguage": "en",
  "supportLanguage": "en",
  "level": "B2",
  "modules": [{
    "id": "m1",
    "title": "Module 1",
    "description": "Work and study",
    "topics": [{
      "id": "en-b2-m1-deadlines",
      "moduleId": "m1",
      "title": "Deadlines",
      "kind": "vocabulary",
      "context": "Short rule or situation (markdown).",
      "keyItems": [
        { "target": "meet a deadline", "support": "finish on time" }
      ],
      "exercises": [{
        "id": "en-b2-m1-deadlines-01",
        "type": "fill_gaps",
        "topicId": "en-b2-m1-deadlines",
        "difficulty": 1,
        "allowedModes": ["tiles", "typing"],
        "prompt": "Fill the gap.",
        "explanation": "We say «meet» a deadline.",
        "template": "We must ___ the deadline.",
        "gaps": [{ "answer": "meet" }],
        "wordBank": ["meet", "make", "do"]
      }]
    }]
  }],
  "phraseSets": []
}`;

/** "?" next to Import course: a short reminder of what the file is and how it looks. */
export function ImportHelpButton() {
  const t = useT();
  const titleId = useId();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('courses.help.open')}
        className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted"
      >
        <CircleHelp size={20} strokeWidth={2} aria-hidden />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} titleId={titleId}>
        <h2 id={titleId} className="text-lg font-semibold text-text">
          {t('courses.help.title')}
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-text">
          <li>{t('courses.help.what')}</li>
          <li>{t('courses.help.ids')}</li>
          <li>{t('courses.help.replace')}</li>
          <li>{t('courses.help.more')}</li>
        </ul>
        <p className="mt-3 text-xs font-semibold tracking-wide text-muted uppercase">
          {t('courses.help.example')}
        </p>
        <pre className="mt-1 max-h-[40vh] overflow-auto rounded-xl border border-line bg-paper p-3 font-mono text-[11px] leading-snug text-text">
          {COURSE_FILE_EXAMPLE}
        </pre>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="mt-4 min-h-11 w-full rounded-xl border border-line text-sm font-medium text-text"
        >
          {t('courses.close')}
        </button>
      </Sheet>
    </>
  );
}
