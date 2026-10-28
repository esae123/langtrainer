// React side of the AI check (docs/stage-7-spec.md): decides the route for an answer,
// runs the request, keeps the usage counters and suspension, and shows the one-off
// suspension toast. The session runner owns what happens with the verdict.
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useToast } from '../components/toastStore';
import { useT } from '../i18n';
import type { Settings } from '../settings/settings';
import { aiSuspension, recordAiUsage, suspendAi } from './aiState';
import {
  aiRoute,
  runAiCheck,
  type AiCallDeps,
  type AiCheckContext,
  type AiCheckOutcome,
  type AiGateInput,
  type AiRoute,
} from './openaiCheck';

export interface AiCheckHandle {
  route: (input: Pick<AiGateInput, 'mode' | 'exerciseType' | 'locallyCorrect'>) => AiRoute;
  /** Starts a check; `onDone` is not called when the check is cancelled first. */
  start: (context: AiCheckContext, onDone: (outcome: AiCheckOutcome) => void) => void;
  cancel: () => void;
}

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

export function useAiCheck(
  settings: Settings,
  deps: Omit<AiCallDeps, 'signal'> = {}
): AiCheckHandle {
  const t = useT();
  const showToast = useToast();
  const controllerRef = useRef<AbortController | null>(null);
  const settingsRef = useRef(settings);
  const depsRef = useRef(deps);
  const toastRef = useRef({ t, showToast });
  useEffect(() => {
    settingsRef.current = settings;
    depsRef.current = deps;
    toastRef.current = { t, showToast };
  });

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  // Leaving the session aborts a check that is still in flight.
  useEffect(() => cancel, [cancel]);

  const route = useCallback<AiCheckHandle['route']>((input) => {
    const current = settingsRef.current;
    return aiRoute({
      ...input,
      aiCheckEnabled: current.aiCheckEnabled,
      openaiApiKey: current.openaiApiKey,
      online: isOnline(),
      suspended: aiSuspension(current) !== null,
    });
  }, []);

  const start = useCallback<AiCheckHandle['start']>(
    (context, onDone) => {
      cancel();
      const controller = new AbortController();
      controllerRef.current = controller;
      const current = settingsRef.current;
      void runAiCheck(
        { apiKey: current.openaiApiKey, model: current.openaiModel, context },
        { ...depsRef.current, signal: controller.signal }
      ).then((outcome) => {
        if (controller.signal.aborted) return;
        if (controllerRef.current === controller) controllerRef.current = null;
        const { t: translate, showToast: toast } = toastRef.current;
        if (outcome.kind === 'verdict') {
          void recordAiUsage(outcome.result.totalTokens);
        } else if (outcome.reason === 'invalidKey') {
          suspendAi('invalidKey', current);
          toast(translate('ai.toastInvalidKey'));
        } else if (outcome.reason === 'noCredit') {
          suspendAi('noCredit', current);
          toast(translate('ai.toastNoCredit'));
        }
        onDone(outcome);
      });
    },
    [cancel]
  );

  return useMemo(() => ({ route, start, cancel }), [route, start, cancel]);
}
