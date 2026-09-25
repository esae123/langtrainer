import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { validateProgram } from '../../content/validateProgram';
import { checkContent } from '../../content/contentRules';
import { COURSE_FILE_EXAMPLE, ImportHelpButton } from '../ImportHelp';

describe('ImportHelpButton', () => {
  it('opens a reminder with the example structure', () => {
    render(<ImportHelpButton />);
    fireEvent.click(screen.getByRole('button', { name: 'What is a course file?' }));
    expect(screen.getByRole('dialog', { name: 'Importing a course' })).toBeInTheDocument();
    expect(screen.getByText(/"phraseSets": \[\]/)).toBeInTheDocument();
  });

  it('shows an example that the importer accepts', () => {
    const program = validateProgram(JSON.parse(COURSE_FILE_EXAMPLE));
    const errors = checkContent(program).problems.filter((p) => p.severity !== 'warning');
    expect(errors).toEqual([]);
  });
});
