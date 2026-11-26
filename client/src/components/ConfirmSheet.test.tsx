import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmSheet } from './ConfirmSheet';

function renderSheet(busy: boolean) {
  const onCancel = vi.fn();
  render(
    <ConfirmSheet
      title="Leave Cafe?"
      text="You lose its orders and tools at once."
      confirmLabel="Leave"
      onConfirm={vi.fn()}
      onCancel={onCancel}
      busy={busy}
    />,
  );
  const keep = screen.getByRole('button', { name: 'Keep' });
  const backdrop = screen.getByRole('dialog').previousElementSibling as Element;
  return { onCancel, keep, backdrop };
}

describe('ConfirmSheet', () => {
  it('Keep, Escape and the backdrop close it', () => {
    const { onCancel, keep, backdrop } = renderSheet(false);
    fireEvent.click(keep);
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(backdrop);
    expect(onCancel).toHaveBeenCalledTimes(3);
  });

  it('while its action is out, Keep, Escape and the backdrop do nothing: the action goes on regardless', () => {
    const { onCancel, keep, backdrop } = renderSheet(true);
    expect(keep).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(keep);
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(backdrop);
    expect(onCancel).not.toHaveBeenCalled();
  });
});
