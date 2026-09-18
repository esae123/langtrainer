import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Sheet } from '../Sheet';

describe('Sheet', () => {
  it('labels the dialog via aria-labelledby pointing at the title', () => {
    render(
      <Sheet open onClose={() => {}} titleId="my-title">
        <h2 id="my-title">Hello there</h2>
      </Sheet>
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-labelledby', 'my-title');
    expect(document.getElementById('my-title')).toHaveTextContent('Hello there');
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} titleId="t">
        <h2 id="t">Title</h2>
      </Sheet>
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not attach an Escape listener (or call onClose) while closed', () => {
    const onClose = vi.fn();
    render(
      <Sheet open={false} onClose={onClose} titleId="t">
        <h2 id="t">Title</h2>
      </Sheet>
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders nothing when closed', () => {
    render(
      <Sheet open={false} onClose={() => {}} titleId="t">
        <h2 id="t">Title</h2>
      </Sheet>
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
