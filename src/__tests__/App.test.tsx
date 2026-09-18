import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import App from '../App';
import { db } from '../db/db';

afterEach(async () => {
  window.location.hash = '';
  await Promise.all(db.tables.map((table) => table.clear()));
});

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
});
