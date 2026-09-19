import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LetterBoard } from '../widgets/LetterBoard';
import { TileBank } from '../widgets/TileBank';
import { TypingHint } from '../widgets/TypingHint';
import { TypingInput } from '../widgets/TypingInput';
import { composeLetters, fillableCount, letterKeys, letterRows } from '../widgets/letters';
import { toTiles } from '../widgets/tiles';
import { mulberry32 } from '../../engine/rng';

function TileBankHarness() {
  const [placedIds, setPlacedIds] = useState<string[]>([]);
  const tiles = toTiles(['Eu', 'falo', 'inglês']);
  return (
    <>
      <TileBank tiles={tiles} placedIds={placedIds} onChange={setPlacedIds} slots={3} />
      <output data-testid="answer">
        {placedIds
          .map((id) => tiles.find((tile) => tile.id === id)?.label)
          .filter(Boolean)
          .join(' ')}
      </output>
    </>
  );
}

function LetterBoardHarness({ answer = 'chamo-me ana' }: { answer?: string }) {
  const [typed, setTyped] = useState('');
  return (
    <>
      <LetterBoard answer={answer} typed={typed} onChange={setTyped} seed={7} />
      <output data-testid="composed">{composeLetters(answer, typed)}</output>
    </>
  );
}

function TypingHarness() {
  const [value, setValue] = useState('');
  return (
    <>
      <TypingInput value={value} onChange={setValue} label="Your answer" />
      <output data-testid="value">{value}</output>
    </>
  );
}

describe('TileBank', () => {
  it('appends tapped tiles to the answer line and removes them again', () => {
    render(<TileBankHarness />);

    fireEvent.click(screen.getByRole('button', { name: 'Add falo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Eu' }));
    expect(screen.getByTestId('answer')).toHaveTextContent('falo Eu');

    // Placed tiles stay in the bank as invisible placeholders, so the layout is stable.
    const placeholder = screen
      .getByLabelText('Word tiles')
      .querySelector('[aria-label="Add falo"]');
    expect(placeholder).toBeDisabled();
    expect(placeholder).toHaveClass('invisible');

    fireEvent.click(screen.getByRole('button', { name: 'Remove falo' }));
    expect(screen.getByTestId('answer')).toHaveTextContent('Eu');
    expect(screen.getByRole('button', { name: 'Add falo' })).toBeEnabled();
  });
});

describe('LetterBoard', () => {
  it('keeps letter keys available after use and supports backspace', () => {
    render(<LetterBoardHarness answer="ana" />);
    const aKey = screen.getByRole('button', { name: 'a' });

    fireEvent.click(aKey);
    expect(screen.getByTestId('composed')).toHaveTextContent('a');
    // The key is still there for the second "a".
    fireEvent.click(screen.getByRole('button', { name: 'n' }));
    fireEvent.click(aKey);
    expect(screen.getByTestId('composed')).toHaveTextContent('ana');

    fireEvent.click(screen.getByRole('button', { name: /delete the last letter/i }));
    expect(screen.getByTestId('composed')).toHaveTextContent('an');
  });

  it('never accepts more letters than the answer has boxes', () => {
    render(<LetterBoardHarness answer="ana" />);
    for (let i = 0; i < 5; i += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'a' }));
    }
    expect(screen.getByTestId('composed')).toHaveTextContent('aaa');
  });

  it('pre-fills separators and offers accent twins as distractors', () => {
    render(<LetterBoardHarness answer="chamo-me ana" />);
    // Two rows of boxes (one per word) and the hyphen is not a key.
    expect(letterRows('chamo-me ana')).toHaveLength(2);
    expect(fillableCount('chamo-me ana')).toBe(10);

    const keys = letterKeys('não', mulberry32(1));
    expect(keys).toContain('ã');
    expect(keys).toContain('a');
    expect(keys.length).toBe(new Set(keys).size);
    expect(keys.length).toBeGreaterThan(3);
  });

  it('composes the answer with its pre-filled characters', () => {
    expect(composeLetters('chamo-me ana', 'chamomeana')).toBe('chamo-me ana');
    expect(composeLetters('chamo-me ana', 'cha')).toBe('cha');
  });

  it('pre-fills punctuation so only letters have to be typed', () => {
    expect(fillableCount('Eu falo inglês.')).toBe(12);
    expect(composeLetters('Eu falo inglês.', 'eufaloingles')).toBe('eu falo ingles');
    // Terminal punctuation is not typed and is not needed for the check either.
    expect(composeLetters('Eu falo inglês.', 'eufaloinglês')).toBe('eu falo inglês');
    expect(letterKeys('Moras aqui?', mulberry32(2))).not.toContain('?');
  });
});

describe('TypingInput', () => {
  it('inserts an accented character at the caret', () => {
    render(<TypingHarness />);
    const input = screen.getByLabelText('Your answer') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'portugues' } });
    // Select the plain "e" so the accent bar replaces it.
    input.setSelectionRange(7, 8);
    fireEvent.click(screen.getByRole('button', { name: 'Insert ê' }));

    expect(screen.getByTestId('value')).toHaveTextContent('português');
    expect(input.selectionStart).toBe(8);
  });

  it('appends at the end when nothing is focused', () => {
    render(<TypingHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Insert ç' }));
    expect(screen.getByTestId('value')).toHaveTextContent('ç');
  });

  it('labels the accent bar and lays it out as a grid that always fits', () => {
    render(<TypingHarness />);
    expect(screen.getByText('Accents — tap to insert')).toBeInTheDocument();
    const bar = screen.getByRole('group', { name: 'Accented characters' });
    // Six columns on a narrow screen, twelve from 480px up — never a scrolling row.
    expect(bar).toHaveClass('grid', 'grid-cols-6', 'min-[480px]:grid-cols-12');
    expect(bar.className).not.toContain('overflow-x-auto');
  });
});

describe('TypingHint', () => {
  it('shows the first letter, blanks and the length', () => {
    render(<TypingHint expected="sopa" />);
    expect(screen.getByText('s _ _ _')).toBeInTheDocument();
    expect(screen.getByText('(4 letters)')).toBeInTheDocument();
  });

  it('shows nothing for a long answer or no answer', () => {
    const { container } = render(
      <>
        <TypingHint expected="eu falo inglês" />
        <TypingHint expected={null} />
      </>
    );
    expect(container).toBeEmptyDOMElement();
  });
});
