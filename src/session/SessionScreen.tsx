import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Card } from '../components/Card';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { getProgram } from '../content/programs';
import { useT } from '../i18n';
import { useSettings } from '../settings/settingsStore';
import { ContextPanel } from './ContextPanel';
import { ExercisePanel } from './ExercisePanel';
import { SummaryPanel } from './SummaryPanel';
import { currentItem } from './sessionState';
import { topicInfo } from './topicLookup';
import { useSessionRunner } from './useSessionRunner';

/** `/session` — full-screen flow with no bottom tab bar. */
export function SessionScreen() {
  // Remounting with a new key is how "Another session" plans a fresh session.
  const [runKey, setRunKey] = useState(0);
  const [searchParams] = useSearchParams();
  return (
    <SessionRun
      key={runKey}
      resume={runKey === 0 && searchParams.get('resume') === '1'}
      onRestart={() => setRunKey((key) => key + 1)}
    />
  );
}

function SessionRun({ resume, onRestart }: { resume: boolean; onRestart: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const settings = useSettings();
  const program = getProgram(settings.activeProgramId);
  const runner = useSessionRunner(program, settings, resume);
  const [stopOpen, setStopOpen] = useState(false);
  const { state } = runner;

  const shell =
    'mx-auto flex min-h-screen w-full max-w-[480px] flex-col bg-slate-50 dark:bg-slate-950';

  if (!state) {
    return (
      <div className={shell}>
        <div className="flex flex-1 items-center justify-center px-4">
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('session.loading')}</p>
        </div>
      </div>
    );
  }

  if (state.plan.items.length === 0) {
    return (
      <div className={shell}>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
          <Card>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
              {t('session.emptyTitle')}
            </h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              {t('session.emptyBody')}
            </p>
          </Card>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="min-h-12 rounded-2xl bg-accent-600 px-6 text-base font-semibold text-white"
          >
            {t('session.back')}
          </button>
        </div>
      </div>
    );
  }

  if (state.phase === 'summary') {
    return (
      <div className={shell}>
        <SummaryPanel
          state={state}
          outcomes={runner.outcomes}
          program={program}
          onDone={() => navigate('/')}
          onAnother={onRestart}
        />
      </div>
    );
  }

  const item = currentItem(state);
  if (!item) return <div className={shell} />;
  const info = topicInfo(program, item.topicId);

  if (state.phase === 'context') {
    return (
      <div className={shell}>
        <ContextPanel info={info} onStart={runner.startExercises} />
      </div>
    );
  }

  const previous = state.plan.items[state.index - 1];
  const firstOfBlock = !previous || previous.block !== item.block;
  const blockLabel =
    item.block === 'review'
      ? t('session.block.review', { topic: info.title })
      : item.block === 'phrases'
        ? t('session.block.phrases')
        : t('session.block.new');

  return (
    <div className={shell}>
      <ExercisePanel
        key={item.exercise.id}
        item={item}
        index={state.index}
        total={state.plan.plannedLength}
        blockLabel={blockLabel}
        banner={firstOfBlock && item.block !== 'new' ? blockLabel : null}
        feedback={state.feedback}
        onSubmit={runner.submit}
        onContinue={runner.next}
        onSelfGrade={runner.selfGrade}
        onStop={() => setStopOpen(true)}
      />
      <ConfirmDialog
        open={stopOpen}
        title={t('session.stopTitle')}
        body={t('session.stopBody')}
        confirmLabel={t('session.stopConfirm')}
        cancelLabel={t('session.stopCancel')}
        onConfirm={() => {
          setStopOpen(false);
          runner.stop();
        }}
        onCancel={() => setStopOpen(false)}
      />
    </div>
  );
}
