import { useEffect, useState } from 'react';
import type { InputMode } from '../../content/types';
import { useT } from '../../i18n';
import { LetterBoard } from './LetterBoard';
import { OptionList } from './OptionList';
import { TypingInput } from './TypingInput';
import { composeLetters, isLettersComplete } from './letters';

interface TextAnswerInputProps {
  /** The expected text; shapes the letter boxes. */
  answer: string;
  /** Choices for tiles mode. */
  options?: string[];
  mode: InputMode;
  seed: number;
  /** Receives the composed answer, or `null` while it is incomplete. */
  onText: (text: string | null) => void;
  onSubmit?: () => void;
  multiline?: boolean;
  label?: string;
  targetLanguage?: string;
}

/**
 * The shared "one short text answer" input: options in tiles mode, a LetterBoard in
 * letters mode, a typing field with accent bar in typing mode.
 */
export function TextAnswerInput({
  answer,
  options,
  mode,
  seed,
  onText,
  onSubmit,
  multiline,
  label,
  targetLanguage = 'pt-PT',
}: TextAnswerInputProps) {
  const t = useT();
  const [selected, setSelected] = useState<string | null>(null);
  const [typedLetters, setTypedLetters] = useState('');
  const [text, setText] = useState('');

  useEffect(() => {
    if (mode === 'tiles') {
      onText(selected);
      return;
    }
    if (mode === 'letters') {
      onText(isLettersComplete(answer, typedLetters) ? composeLetters(answer, typedLetters) : null);
      return;
    }
    onText(text.trim() === '' ? null : text);
  }, [mode, selected, typedLetters, text, answer, onText]);

  if (mode === 'tiles') {
    return (
      <OptionList
        options={options ?? []}
        value={selected}
        onChange={setSelected}
        label={label ?? t('session.options')}
      />
    );
  }
  if (mode === 'letters') {
    return (
      <LetterBoard
        answer={answer}
        typed={typedLetters}
        onChange={setTypedLetters}
        seed={seed}
        targetLanguage={targetLanguage}
      />
    );
  }
  return (
    <TypingInput
      value={text}
      onChange={setText}
      onSubmit={onSubmit}
      multiline={multiline}
      label={label ?? t('session.typeAnswer')}
      placeholder={t('session.typeAnswerPlaceholder')}
      targetLanguage={targetLanguage}
    />
  );
}
