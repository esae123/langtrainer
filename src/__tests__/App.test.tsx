import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { db } from '../db/db';
import type { SettingsRow } from '../db/db';

afterEach(async () => {
  window.location.hash = '';
  sessionStorage.clear();
  await Promise.all(db.tables.map((table) => table.clear()));
});

async function readStoredOpenaiApiKey(): Promise<string | undefined> {
  const row = (await db.settings.get('settings')) as SettingsRow | undefined;
  const value = row?.value as { openaiApiKey?: string } | undefined;
  return value?.openaiApiKey;
}

describe('App', () => {
  it('renders the Learn screen with the bottom tab bar', async () => {
    render(<App />);
    expect(await screen.findByRole('heading', { name: /hi there/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /learn/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /progress/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /settings/i })).toBeInTheDocument();
  });

  it('renders the Settings screen with all groups', async () => {
    window.location.hash = '#/settings';
    render(<App />);
    await waitFor(() => expect(screen.getByText('AI')).toBeInTheDocument());
    expect(screen.getByText('Backup')).toBeInTheDocument();
    expect(screen.getByText('Danger zone')).toBeInTheDocument();
    expect(screen.getByText('About')).toBeInTheDocument();
  });

  it('renders the Progress screen empty state', async () => {
    window.location.hash = '#/progress';
    render(<App />);
    expect(await screen.findByText(/nothing to show yet/i)).toBeInTheDocument();
  });

  it('gives the language select and API key input accessible names', async () => {
    window.location.hash = '#/settings';
    render(<App />);
    expect(await screen.findByLabelText(/app language/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/openai api key/i)).toBeInTheDocument();
    // Gemini is gone from the UI (docs/stage-7-spec.md §1).
    expect(screen.queryByText(/gemini/i)).not.toBeInTheDocument();
  });

  it('persists the OpenAI API key on blur, not on every keystroke', async () => {
    window.location.hash = '#/settings';
    render(<App />);
    const input = await screen.findByLabelText(/openai api key/i);

    fireEvent.change(input, { target: { value: 'sk-test-key' } });
    expect(await readStoredOpenaiApiKey()).not.toBe('sk-test-key');

    fireEvent.blur(input);
    await waitFor(async () => expect(await readStoredOpenaiApiKey()).toBe('sk-test-key'));
  });

  it('AI check: off by default, Test connection reports Connected with a mocked fetch', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      window.location.hash = '#/settings';
      render(<App />);
      const toggle = await screen.findByRole('switch', { name: 'Check typed answers with AI' });
      expect(toggle).toHaveAttribute('aria-checked', 'false');
      expect(screen.getByLabelText('Model')).toHaveValue('gpt-5.4-mini');
      expect(screen.getByText('AI checks this month: 0 · ~0 tokens')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
      expect(await screen.findByText('Enter an API key first')).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();

      fireEvent.change(screen.getByLabelText(/openai api key/i), {
        target: { value: 'sk-settings-test' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
      expect(await screen.findByText('Connected')).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps the backup reminder dismissed for the session across a route change', async () => {
    render(<App />);
    const dismissButton = await screen.findByRole('button', { name: /not now/i });
    fireEvent.click(dismissButton);
    await waitFor(() => expect(screen.queryByText(/back up your progress/i)).not.toBeInTheDocument());

    // Navigate away and back: LearnScreen unmounts and remounts.
    window.location.hash = '#/settings';
    await waitFor(() => expect(screen.getByText('AI')).toBeInTheDocument());
    window.location.hash = '#/';
    await screen.findByRole('heading', { name: /hi there/i });

    expect(screen.queryByText(/back up your progress/i)).not.toBeInTheDocument();
  });

  it('switches the session mix and keeps the custom sliders at 100', async () => {
    window.location.hash = '#/settings';
    render(<App />);
    expect(await screen.findByText('Session mix')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^balanced/i })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: /^more review/i }));
    await waitFor(async () => {
      const row = (await db.settings.get('settings')) as SettingsRow | undefined;
      expect((row?.value as { sessionMix?: unknown })?.sessionMix).toEqual({
        preset: 'more-review',
        shares: { new: 30, review: 55, phrases: 15 },
      });
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^more review/i })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
    );

    const customPreset = screen.getByRole('button', { name: /set your own split/i });
    fireEvent.click(customPreset);
    await waitFor(() => expect(customPreset).toHaveAttribute('aria-pressed', 'true'));
    const slider = await screen.findByRole('slider', { name: /new topic/i });
    fireEvent.change(slider, { target: { value: '0' } });
    await waitFor(async () => {
      const row = (await db.settings.get('settings')) as SettingsRow | undefined;
      expect((row?.value as { sessionMix?: unknown })?.sessionMix).toEqual({
        preset: 'custom',
        shares: { new: 0, review: 79, phrases: 21 },
      });
    });
  });
});
