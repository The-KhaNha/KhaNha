import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Input } from './Input';

describe('Input hint', () => {
  it('describes the field by its hint, then its error', () => {
    render(<Input label="Phone" hint="Optional" error="Enter a valid phone number." />);
    const field = screen.getByLabelText('Phone');
    const ids = field.getAttribute('aria-describedby')?.split(' ') ?? [];
    expect(ids.map((id) => document.getElementById(id)?.textContent)).toEqual([
      'Optional',
      'Enter a valid phone number.',
    ]);
  });

  it('keeps a short hint on the label line by default', () => {
    render(<Input label="Phone" hint="Optional" />);
    const hint = screen.getByText('Optional');
    expect(hint.tagName).toBe('SPAN');
    expect(hint.parentElement).toBe(screen.getByText('Phone').parentElement);
  });

  it('puts a long hint on its own line under the label with hintPlacement="below"', () => {
    render(
      <Input
        label="Order page refresh (ms)"
        hint="How often an open order checks"
        hintPlacement="below"
      />,
    );
    const hint = screen.getByText('How often an open order checks');
    expect(hint.tagName).toBe('P');
    expect(screen.getByLabelText('Order page refresh (ms)').getAttribute('aria-describedby')).toBe(
      hint.id,
    );
  });

  it('has no aria-describedby without a hint or an error', () => {
    render(<Input label="Name" />);
    expect(screen.getByLabelText('Name').hasAttribute('aria-describedby')).toBe(false);
  });
});
