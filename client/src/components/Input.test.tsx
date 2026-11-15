import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Input, Textarea } from './Input';

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

  // WCAG 1.4.11: the edge is what shows where to type, so it needs 3:1 against the card. `hint` is held to 3:1 on
  // surface in both schemes by lib/palette.test.ts; the decorative `line` is about 1.3:1.
  it('draws an idle field edge in a 3:1 colour, and the error one in brand', () => {
    render(
      <>
        <Input label="Name" />
        <Textarea label="Note" />
        <Input label="Phone" error="Enter a phone number." />
      </>,
    );
    expect(screen.getByLabelText('Name')).toHaveClass('border-hint');
    expect(screen.getByLabelText('Note')).toHaveClass('border-hint');
    expect(screen.getByLabelText('Phone')).toHaveClass('border-brand-600');
  });
});
