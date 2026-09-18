import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import App from '../App';
import { db } from '../db/db';
import type { SettingsRow } from '../db/db';

afterEach(async () => {
  window.location.hash = '';
  sessionStorage.clear();
  await Promise.all(db.tables.map((table) => table.clear()));
});

async function readStoredGeminiApiKey(): Promise<string | undefined> {
  const row = (await db.settings.get('settings')) as SettingsRow | undefined;
  const value = row?.value as { geminiApiKey?: string } | undefined;
  return value?.geminiApiKey;
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
    expect(screen.getByLabelText(/gemini api key/i)).toBeInTheDocument();
  });

  it('persists the Gemini API key on blur, not on every keystroke', async () => {
    window.location.hash = '#/settings';
    render(<App />);
    const input = await screen.findByLabelText(/gemini api key/i);

    fireEvent.change(input, { target: { value: 'AIza-test-key' } });
    expect(await readStoredGeminiApiKey()).not.toBe('AIza-test-key');

    fireEvent.blur(input);
    await waitFor(async () => expect(await readStoredGeminiApiKey()).toBe('AIza-test-key'));
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
});
