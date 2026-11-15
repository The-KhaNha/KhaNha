import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';

describe('Button while loading', () => {
  it('keeps keyboard focus, is announced as busy, and ignores clicks and the form submit they carry', () => {
    const onClick = vi.fn();
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    const { rerender } = render(
      <form onSubmit={onSubmit}>
        <Button type="submit" onClick={onClick}>
          Pay
        </Button>
      </form>,
    );
    const button = screen.getByRole('button', { name: 'Pay' });
    button.focus();

    rerender(
      <form onSubmit={onSubmit}>
        <Button type="submit" onClick={onClick} loading>
          Pay
        </Button>
      </form>,
    );
    expect(document.activeElement).toBe(button);
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('works normally when not loading', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
