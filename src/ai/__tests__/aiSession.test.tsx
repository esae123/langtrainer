import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';
import { db } from '../../db/db';
import { updateSettings } from '../../settings/settingsStore';
import type { Settings } from '../../settings/settings';
import { clearAiSuspension, readAiUsage } from '../aiState';

// One topic: two open build_phrase exercises, an about_me and a closed translate_word.
vi.mock('../../content/programs', async () => {
  const { makeProgram, makeTopic, makeTranslateWord, makeBuildPhrase } =
    await import('../../test/fixtures');
  const program = makeProgram([
    {
      id: 'm1',
      title: 'Module 1',
      description: 'Fixture module',
      topics: [
        makeTopic('t1', 'm1', 0, {
          title: 'Regular -ar verbs',
          exercises: [
            makeBuildPhrase('t1-e1', 't1'),
            {
              id: 't1-e2',
              type: 'about_me' as const,
              topicId: 't1',
              difficulty: 1 as const,
              allowedModes: ['tiles' as const, 'typing' as const],
              prompt: 'Answer about yourself.',
              explanation: 'Morar goes with em.',
              question: 'Onde é que moras?',
              sampleAnswer: 'Moro em Lisboa.',
              hints: ['numa', 'aldeia'],
            },
            makeTranslateWord('t1-e3', 't1'),
            makeBuildPhrase('t1-e4', 't1', {
              prompt: "Build: 'You speak English.'",
              answer: ['Tu', 'falas', 'inglês.'],
              distractors: ['falo'],
              acceptedAnswers: [],
            }),
          ],
        }),
      ],
    },
  ]);
  return { programs: [program] };
});

const KEY = 'sk-session-test-key';
const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();

function completion(verdict: string, correction = 'Eu falo inglês.'): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({ verdict, correction, explanation: 'Use falo with eu.' }),
          },
        },
      ],
      usage: { total_tokens: 310 },
    }),
    { status: 200 }
  );
}

function errorResponse(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: { code, message: code } }), { status });
}

/** A request that never answers until it is aborted. */
function hangingFetch(_url: string, init: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
}

async function setup(overrides: Partial<Settings> = {}) {
  await updateSettings({
    inputPreset: 'custom',
    inputShares: { tiles: 0, letters: 0, typing: 100 },
    sessionLength: 10,
    aiCheckEnabled: true,
    openaiApiKey: KEY,
    ...overrides,
  });
}

beforeEach(() => {
  window.location.hash = '#/session';
  clearAiSuspension();
  fetchMock.mockReset();
  // Answers given on the way to the exercise under test may use the AI.
  fetchMock.mockImplementation(async () => completion('correct'));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.location.hash = '';
  await Promise.all(db.tables.map((table) => table.clear()));
});

function renderApp() {
  return render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

type Kind = 'build' | 'build2' | 'aboutMe' | 'translate';
const OPEN: Kind[] = ['build', 'build2', 'aboutMe'];

/** Which fixture exercise is on screen, or null at the summary. */
function shownKind(): Kind | null {
  if (screen.queryByText('Onde é que moras?')) return 'aboutMe';
  if (screen.queryByText("Build: 'I speak English.'")) return 'build';
  if (screen.queryByText("Build: 'You speak English.'")) return 'build2';
  if (screen.queryByText('Translate the word in bold.')) return 'translate';
  return null;
}

const RIGHT: Record<Kind, string> = {
  build: 'Eu falo inglês.',
  build2: 'Tu falas inglês.',
  aboutMe: 'Moro em Lisboa.',
  translate: 'trabalho',
};
const WRONG: Record<Kind, string> = {
  build: 'Eu falar o inglês',
  build2: 'Tu falar o inglês',
  aboutMe: 'Moro no Porto.',
  translate: 'trabalhas',
};

async function startSession() {
  renderApp();
  fireEvent.click(await screen.findByRole('button', { name: /start exercises/i }));
  await screen.findByRole('button', { name: 'Check' });
}

function typeAndCheck(text: string) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Check' }));
}

/** Dismisses the feedback sheet (Continue, or "Yes"/`grade` on a self-grade). */
async function dismissFeedback(grade: 'Yes' | 'No' = 'Yes') {
  await waitFor(() => {
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toMatch(/Did you get it right\?|Continue/);
  });
  const selfGrade = screen.queryByRole('button', { name: grade });
  fireEvent.click(selfGrade ?? screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}

/** Answers (correctly) and dismisses exercises until one of `kinds` is on screen. */
async function advanceTo(kinds: Kind[]): Promise<Kind> {
  for (let i = 0; i < 4; i += 1) {
    const current = shownKind();
    if (current === null || kinds.includes(current)) break;
    typeAndCheck(RIGHT[current]);
    await dismissFeedback();
  }
  const current = shownKind();
  expect(current !== null && kinds.includes(current)).toBe(true);
  return current!;
}

/** Answers every remaining exercise wrongly, grading "No" where asked. */
async function answerRestWrong(): Promise<Kind[]> {
  const answered: Kind[] = [];
  for (let current = shownKind(); current !== null; current = shownKind()) {
    typeAndCheck(WRONG[current]);
    answered.push(current);
    await dismissFeedback('No');
  }
  return answered;
}

async function attemptFor(exerciseId: string) {
  let row;
  await waitFor(async () => {
    row = (await db.attempts.toArray()).find((attempt) => attempt.exerciseId === exerciseId);
    expect(row).toBeDefined();
  });
  return row!;
}

describe('AI check gating in a session', () => {
  it('toggle off: zero fetch calls even with a key, local verdict as today', async () => {
    await setup({ aiCheckEnabled: false });
    await startSession();
    const answered = await answerRestWrong();
    expect(answered).toEqual(expect.arrayContaining(['build', 'build2', 'aboutMe']));
    expect(await screen.findByText(/session complete/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await attemptFor('t1-e1')).toMatchObject({ correct: false, gradedBy: 'local' });
    expect(await attemptFor('t1-e2')).toMatchObject({ gradedBy: 'self', selfGraded: true });
  });

  it('no key: zero fetch calls', async () => {
    await setup({ openaiApiKey: '' });
    await startSession();
    await answerRestWrong();
    expect(await screen.findByText(/session complete/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a locally accepted answer never reaches the AI', async () => {
    await setup();
    await startSession();
    await advanceTo(['build']);
    const before = fetchMock.mock.calls.length;
    typeAndCheck('Eu falo inglês.');
    expect(await screen.findByText('Correct')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(before);
  });

  it('a closed exercise type never reaches the AI', async () => {
    await setup();
    await startSession();
    await advanceTo(['translate']);
    const before = fetchMock.mock.calls.length;
    typeAndCheck('trabalhas');
    expect(await screen.findByText('Not quite')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(before);
  });

  it('tiles mode never reaches the AI', async () => {
    await setup({ inputShares: { tiles: 100, letters: 0, typing: 0 } });
    await startSession();
    for (let current = shownKind(); current !== null; current = shownKind()) {
      if (current === 'aboutMe') {
        fireEvent.click(screen.getByRole('button', { name: 'Add Moro' }));
      } else if (current === 'translate') {
        fireEvent.click(screen.getByRole('radio', { name: 'trabalhas' }));
      } else {
        fireEvent.click(
          screen.getByRole('button', { name: current === 'build' ? 'Add falas' : 'Add falo' })
        );
      }
      fireEvent.click(screen.getByRole('button', { name: 'Check' }));
      await dismissFeedback('No');
    }
    expect(await screen.findByText(/session complete/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('offline: self-grade fallback without any request', async () => {
    await setup();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await startSession();
    await advanceTo(['build']);
    typeAndCheck('Eu falar o inglês');
    expect(await screen.findByText(/did you get it right\?/i)).toBeInTheDocument();
    expect(screen.getByText(/AI check isn't available/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Mostly' }));
    expect(await attemptFor('t1-e1')).toMatchObject({
      correct: true,
      gradedBy: 'self',
      selfGraded: true,
    });
  });
});

describe('AI verdicts', () => {
  it('"almost" counts as correct, shows the correction and is recorded as an AI grade', async () => {
    await setup();
    await startSession();
    await advanceTo(['build']);
    // Let any AI check answered on the way finish writing its usage first.
    await waitFor(async () =>
      expect((await readAiUsage()).checks).toBe(
        (await db.attempts.toArray()).filter((row) => row.gradedBy === 'ai').length
      )
    );
    const usageBefore = await readAiUsage();
    const before = fetchMock.mock.calls.length;
    fetchMock.mockImplementation(async () => completion('almost'));
    typeAndCheck('Eu falar o inglês');

    expect(await screen.findByText('Almost right')).toBeInTheDocument();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Checked by AI');
    expect(dialog).toHaveTextContent('Correction');
    expect(dialog).toHaveTextContent('Eu falo inglês.');
    expect(dialog).toHaveTextContent('Use falo with eu.');
    // The learner's own answer stays visible.
    expect(dialog).toHaveTextContent('Eu falar o inglês');
    expect(fetchMock).toHaveBeenCalledTimes(before + 1);

    expect(await attemptFor('t1-e1')).toMatchObject({
      correct: true,
      gradedBy: 'ai',
      aiVerdict: 'almost',
      mode: 'typing',
    });
    // The normal progress flow saw a correct answer.
    await waitFor(async () =>
      expect((await db.topicProgress.get('t1'))?.seenExerciseIds).toContain('t1-e1')
    );
    expect((await db.topicProgress.get('t1'))?.wrongExerciseIds ?? []).not.toContain('t1-e1');
    await waitFor(async () => expect((await readAiUsage()).checks).toBe(usageBefore.checks + 1));
    expect((await readAiUsage()).tokens).toBe(usageBefore.tokens + 310);
  });

  it('"incorrect" is recorded as wrong with the correction', async () => {
    await setup();
    await startSession();
    await advanceTo(['build']);
    fetchMock.mockImplementation(async () => completion('incorrect'));
    typeAndCheck('Eu falar o inglês');
    expect(await screen.findByText('Not quite')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveTextContent('Checked by AI');
    expect(await attemptFor('t1-e1')).toMatchObject({
      correct: false,
      gradedBy: 'ai',
      aiVerdict: 'incorrect',
    });
    await waitFor(async () =>
      expect((await db.topicProgress.get('t1'))?.wrongExerciseIds).toContain('t1-e1')
    );
  });

  it('about_me uses the AI when enabled', async () => {
    await setup();
    await startSession();
    await advanceTo(['aboutMe']);
    const before = fetchMock.mock.calls.length;
    fetchMock.mockImplementation(async () => completion('correct', 'Moro no Porto.'));
    typeAndCheck('Moro no Porto.');
    expect(await screen.findByText('Correct')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveTextContent('Checked by AI');
    expect(screen.queryByText(/did you get it right\?/i)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(before + 1);
    const body = JSON.parse(fetchMock.mock.calls[before][1].body as string);
    expect(JSON.parse(body.messages[1].content).exercise.question).toBe('Onde é que moras?');
    expect(await attemptFor('t1-e2')).toMatchObject({ correct: true, gradedBy: 'ai' });
  });

  it('shows "Checking your answer…" and the skip link switches to the self-grade', async () => {
    await setup();
    await startSession();
    await advanceTo(['build']);
    const before = fetchMock.mock.calls.length;
    fetchMock.mockImplementation(hangingFetch);
    typeAndCheck('Eu falar o inglês');

    expect(await screen.findByText('Checking your answer…')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Skip — grade myself' }));
    expect(await screen.findByText(/did you get it right\?/i)).toBeInTheDocument();
    expect(fetchMock.mock.calls[before][1].signal?.aborted).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    expect(await attemptFor('t1-e1')).toMatchObject({ correct: false, gradedBy: 'self' });
  });

  it('a bad reply falls back to the self-grade', async () => {
    await setup();
    await startSession();
    await advanceTo(['build']);
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: 'oops' } }] }), {
          status: 200,
        })
    );
    typeAndCheck('Eu falar o inglês');
    expect(await screen.findByText(/did you get it right\?/i)).toBeInTheDocument();
  });
});

describe('AI suspension in a session', () => {
  async function suspendsAfter(response: () => Response, message: string) {
    await setup();
    await startSession();
    const first = await advanceTo(OPEN);
    const before = fetchMock.mock.calls.length;
    fetchMock.mockImplementation(async () => response());
    typeAndCheck(WRONG[first]);
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(await screen.findByText(/did you get it right\?/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(before + 1);
    await dismissFeedback('No');

    // Every later open answer falls back to the self-grade without a request.
    const rest = await answerRestWrong();
    expect(rest.filter((kind) => OPEN.includes(kind)).length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(before + 1);
    const selfGraded = (await db.attempts.toArray()).filter((row) => row.gradedBy === 'self');
    expect(selfGraded.length).toBeGreaterThanOrEqual(2);
  }

  it('401 suspends the AI with one message; later answers make no request', async () => {
    await suspendsAfter(
      () => errorResponse(401, 'invalid_api_key'),
      'AI check: the API key is not valid'
    );
  });

  it('insufficient_quota suspends the AI', async () => {
    await suspendsAfter(
      () => errorResponse(429, 'insufficient_quota'),
      'AI check: no OpenAI credit left — checking without AI'
    );
  });
});
