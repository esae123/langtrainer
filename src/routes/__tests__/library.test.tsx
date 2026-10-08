import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';
import { db } from '../../db/db';
import type { Program } from '../../content/types';

// A small fixture program — enough to exercise every part of the library screens without
// depending on the real (much larger) authored content.
vi.mock('../../content/programs', () => {
  const fixtureProgram: Program = {
    id: 'pt-PT-A1',
    title: 'Português europeu A1',
    targetLanguage: 'pt-PT',
    supportLanguage: 'en',
    level: 'A1',
    modules: [
      {
        id: 'm1',
        title: 'Module 1 — Basics',
        description: 'Basics module.',
        topics: [
          {
            id: 'm1-greetings',
            moduleId: 'm1',
            title: 'Greetings and politeness',
            kind: 'situation',
            context: '# Greetings\n\nUse **Bom dia** before lunch.\n\n- Olá — hello\n- Adeus — bye',
            keyItems: [
              { target: 'Olá', support: 'hello', note: 'any time' },
              { target: 'Bom dia', support: 'good morning' },
            ],
            exercises: [
              {
                id: 'm1-greetings-01',
                type: 'build_phrase',
                topicId: 'm1-greetings',
                difficulty: 1,
                allowedModes: ['tiles'],
                prompt: 'Say hello to Ana.',
                explanation: 'Olá is used at any time of day.',
                answer: ['Olá', 'Ana!'],
                distractors: ['Adeus'],
              },
            ],
          },
        ],
      },
    ],
    phraseSets: [
      {
        id: 'everyday-1',
        title: 'Everyday phrases 1',
        phrases: [{ target: 'Parabéns!', support: 'Congratulations!', register: 'neutral' }],
        exercises: [
          {
            id: 'everyday-1-01',
            type: 'build_phrase',
            topicId: 'everyday-1',
            difficulty: 1,
            allowedModes: ['tiles'],
            prompt: 'Congratulate a friend.',
            explanation: 'Parabéns is always plural.',
            answer: ['Parabéns!'],
            distractors: ['Obrigado'],
          },
        ],
      },
    ],
  };

  return { programs: [fixtureProgram] };
});

afterEach(async () => {
  window.location.hash = '';
  await Promise.all(db.tables.map((table) => table.clear()));
});

describe('Content library — list', () => {
  it('lists modules with their topics and the phrase sets', async () => {
    window.location.hash = '#/library';
    render(<App />);

    expect(await screen.findByRole('heading', { name: /content library/i })).toBeInTheDocument();
    expect(await screen.findByText('Module 1 — Basics')).toBeInTheDocument();
    expect(screen.getByText('Greetings and politeness')).toBeInTheDocument();
    expect(screen.getByText('Situation · 1 exercises')).toBeInTheDocument();
    expect(screen.getByText('Everyday phrases 1')).toBeInTheDocument();
    expect(screen.getByText('1 exercises')).toBeInTheDocument();
  });
});

describe('Content library — topic detail', () => {
  it('shows the topic context, key items and exercises', async () => {
    window.location.hash = '#/library/m1-greetings';
    render(<App />);

    expect(
      await screen.findByRole('heading', { name: /greetings and politeness/i })
    ).toBeInTheDocument();
    // markdown: bold text and a bullet list item, both rendered from the topic context
    expect(screen.getAllByText('Bom dia').length).toBe(2); // once bold in context, once in the key-items table
    expect(screen.getByText('Olá — hello')).toBeInTheDocument();
    // key items table
    expect(screen.getByText('Olá')).toBeInTheDocument();
    expect(screen.getByText('any time')).toBeInTheDocument();
    // exercise card
    expect(screen.getByText('Say hello to Ana.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Correct answer: Olá Ana!')).toBeInTheDocument());
    expect(screen.getByText('Olá is used at any time of day.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Practise this topic' })).toBeInTheDocument();
  });

  it('labels the focus button of a phrase set "Practise these phrases"', async () => {
    window.location.hash = '#/library/everyday-1';
    render(<App />);

    expect(await screen.findByRole('heading', { name: /everyday phrases 1/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Practise these phrases' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Practise this topic' })).not.toBeInTheDocument();
  });
});
