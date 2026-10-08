import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Card } from '../components/Card';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useActiveProgram, useAllPrograms } from '../content/programRegistry';
import { exercisesByTopic, planPractice, type SessionPlan } from '../engine/plan';
import { useT } from '../i18n';
import { useSettings } from '../settings/settingsStore';
import { resumesSnapshot, useActiveSession, type StoredActiveSession } from './activeSession';
import { ContextPanel } from './ContextPanel';
import { ExercisePanel } from './ExercisePanel';
import { SummaryPanel } from './SummaryPanel';
import { currentItem, type SessionState } from './sessionState';
import { topicInfo } from './topicLookup';
import { useSessionRunner } from './useSessionRunner';

/**
 * A practice plan over the exercises of the session just finished: the wrong ones
 * (`fromMistakes`) or all of them (docs/stage-3b-spec.md §4).
 */
function practicePlanFrom(state: SessionState, fromMistakes: boolean): SessionPlan | null {
  const wrongIds = new Set(
    state.responses.filter((draft) => !draft.correct).map((draft) => draft.exerciseId)
  );
  const items = fromMistakes
    ? state.plan.items.filter((item) => wrongIds.has(item.exercise.id))
    : state.plan.items;
  if (items.length === 0) return null;
  return planPractice(items, {
    id: `${state.sessionId}-p${Date.now().toString(36)}`,
    programId: state.programId,
    fromMistakes,
  });
}

/**
 * `/session` — full-screen flow with no bottom tab bar. `/session?resume=1` resumes the
 * saved session; `/session?focus=<topicId>` starts a focus session on one topic or phrase
 * set (docs/stage-6-spec.md §4). Without `resume=1` a saved session is still picked up
 * when the URL is a plain `/session` or a focus URL for the same topic (Android restores
 * a killed PWA at its last URL), see `resumesSnapshot`.
 */
export function SessionScreen() {
  // Remounting with a new key is how "Another session" / "Practise again" plans afresh.
  const [runKey, setRunKey] = useState(0);
  const [practicePlan, setPracticePlan] = useState<SessionPlan | null>(null);
  // The focus topic of a restart: "Practise again" keeps it, "Another session" has none.
  const [restartFocusId, setRestartFocusId] = useState<string | undefined>(undefined);
  const [searchParams] = useSearchParams();
  const stored = useActiveSession();
  // The snapshot as first loaded decides whether the first run resumes; later saves of
  // the running session must not flip that decision.
  const [initialSnapshot, setInitialSnapshot] = useState<StoredActiveSession | null | undefined>(
    undefined
  );
  if (initialSnapshot === undefined && stored !== undefined) setInitialSnapshot(stored);

  const urlFocus = searchParams.get('focus') ?? undefined;
  const firstRun = runKey === 0;
  const resume =
    firstRun && (searchParams.get('resume') === '1' || resumesSnapshot(initialSnapshot, urlFocus));
  return (
    <SessionRun
      key={runKey}
      resume={resume}
      deciding={firstRun && initialSnapshot === undefined}
      focusTopicId={firstRun ? urlFocus : restartFocusId}
      practicePlan={practicePlan}
      onRestart={(focusTopicId) => {
        setPracticePlan(null);
        setRestartFocusId(focusTopicId);
        setRunKey((key) => key + 1);
      }}
      onPractice={(plan) => {
        setPracticePlan(plan);
        setRunKey((key) => key + 1);
      }}
    />
  );
}

function SessionRun({
  resume,
  deciding,
  focusTopicId,
  practicePlan,
  onRestart,
  onPractice,
}: {
  resume: boolean;
  /** The saved snapshot is still loading, so it is not yet known whether to resume. */
  deciding: boolean;
  focusTopicId: string | undefined;
  practicePlan: SessionPlan | null;
  onRestart: (focusTopicId: string | undefined) => void;
  onPractice: (plan: SessionPlan) => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const settings = useSettings();
  const activeProgram = useActiveProgram();
  const entries = useAllPrograms();
  const stored = useActiveSession();

  // A new session always uses the active course; a *resumed* one keeps running the
  // course it was planned from, even after the learner switched courses
  // (docs/stage-4a-spec.md §2). `undefined` while the snapshot is still loading, so
  // the runner doesn't plan a fresh session from the wrong course first. Likewise
  // `undefined` until the imported courses are loaded: the runner plans exactly once,
  // so it must not see the bundled fallback of an imported active course.
  const resumedProgram =
    resume && stored
      ? entries?.find((entry) => entry.program.id === stored.state.programId)?.program
      : undefined;
  // A focus session runs in the course that contains the topic (the Library lists
  // every installed course), falling back to the active one.
  const focusProgram = focusTopicId
    ? entries?.find((entry) => exercisesByTopic(entry.program).has(focusTopicId))?.program
    : undefined;
  const program =
    entries === undefined || deciding || (resume && stored === undefined)
      ? undefined
      : (resumedProgram ?? focusProgram ?? activeProgram);

  const runner = useSessionRunner(
    program,
    settings,
    resume,
    practicePlan ?? undefined,
    focusTopicId
  );
  const [stopOpen, setStopOpen] = useState(false);
  const { state } = runner;

  const shell = 'mx-auto flex min-h-screen w-full max-w-[480px] flex-col bg-paper';

  if (!state) {
    return (
      <div className={shell}>
        <div className="flex flex-1 items-center justify-center px-4">
          <p className="text-sm text-muted">{t('session.loading')}</p>
        </div>
      </div>
    );
  }

  if (state.plan.items.length === 0) {
    return (
      <div className={shell}>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
          <Card>
            <h1 className="text-lg font-semibold text-text">{t('session.emptyTitle')}</h1>
            <p className="mt-2 text-sm text-muted">{t('session.emptyBody')}</p>
          </Card>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="min-h-12 rounded-2xl bg-accent px-6 text-base font-semibold text-accent-ink"
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
          onAnother={() =>
            onRestart(state.plan.kind === 'focus' ? state.plan.focusTopicId : undefined)
          }
          onRetryMistakes={() => {
            const plan = practicePlanFrom(state, true);
            if (plan) onPractice(plan);
          }}
          onRepeat={() => {
            const plan = practicePlanFrom(state, false);
            if (plan) onPractice(plan);
          }}
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
  const practice = state.plan.kind === 'practice';
  const firstOfBlock = !previous || previous.block !== item.block;
  const blockLabel = practice
    ? t('session.block.practice')
    : item.block === 'focus'
      ? t('session.block.focus', { topic: info.title })
      : item.block === 'review'
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
        banner={
          !practice && firstOfBlock && item.block !== 'new' && item.block !== 'focus'
            ? blockLabel
            : null
        }
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
