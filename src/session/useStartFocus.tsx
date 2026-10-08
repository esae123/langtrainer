// Starting a focus session (docs/stage-6-spec.md §4) from the Library or Progress
// screens. An unfinished session is never thrown away silently: the learner confirms
// first, and only then is the saved snapshot discarded (recorded as interrupted when it
// has answers).
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useT } from '../i18n';
import { discardActiveSession, readActiveSession } from './activeSession';

/** The route of a focus session on one topic or phrase set. */
export function focusSessionPath(topicId: string): string {
  return `/session?focus=${encodeURIComponent(topicId)}`;
}

export function useStartFocus(): {
  startFocus: (topicId: string, title: string) => void;
  confirmSheet: ReactNode;
} {
  const t = useT();
  const navigate = useNavigate();
  const [pending, setPending] = useState<{ topicId: string; title: string } | null>(null);

  function startFocus(topicId: string, title: string) {
    // Read the snapshot at tap time (not a live query that may still be loading), so an
    // unfinished session is never overwritten without asking.
    void readActiveSession().then((stored) => {
      if (stored) setPending({ topicId, title });
      else navigate(focusSessionPath(topicId));
    });
  }

  const confirmSheet = (
    <ConfirmDialog
      open={pending !== null}
      title={t('focus.confirmTitle')}
      body={t('focus.confirmBody', { topic: pending?.title ?? '' })}
      confirmLabel={t('focus.confirmDiscard')}
      cancelLabel={t('focus.confirmCancel')}
      danger
      onConfirm={() => {
        const target = pending;
        setPending(null);
        if (!target) return;
        // A discarded session with answers is recorded as interrupted (session row +
        // finishSession), so the day keeps its streak and the answers their history.
        void readActiveSession()
          .then((stored) => (stored ? discardActiveSession(stored) : undefined))
          .then(() => navigate(focusSessionPath(target.topicId)));
      }}
      onCancel={() => setPending(null)}
    />
  );

  return { startFocus, confirmSheet };
}
