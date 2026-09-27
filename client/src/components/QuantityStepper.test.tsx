import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { QuantityStepper } from './QuantityStepper';

describe('QuantityStepper tap targets', () => {
  it('gives the neutral, size=sm halves 44px classes (h-11 on the group, w-11 on each half)', () => {
    render(
      <QuantityStepper quantity={1} onIncrement={() => {}} onDecrement={() => {}} tone="neutral" />,
    );
    expect(screen.getByRole('group')).toHaveClass('h-11');
    expect(screen.getByRole('button', { name: 'Decrease quantity' })).toHaveClass('w-11');
    expect(screen.getByRole('button', { name: 'Increase quantity' })).toHaveClass('w-11');
  });

  it('uses an outer ring, not a border, for the neutral tone (a border would eat into the 44px target)', () => {
    render(
      <QuantityStepper quantity={1} onIncrement={() => {}} onDecrement={() => {}} tone="neutral" />,
    );
    const group = screen.getByRole('group');
    expect(group.className).toMatch(/\bring-1\b/);
    expect(group.className).not.toMatch(/\bborder\b/);
  });

  it('gives the size=md halves 48px classes instead', () => {
    render(
      <QuantityStepper
        quantity={1}
        onIncrement={() => {}}
        onDecrement={() => {}}
        tone="neutral"
        size="md"
      />,
    );
    expect(screen.getByRole('group')).toHaveClass('h-12');
    expect(screen.getByRole('button', { name: 'Decrease quantity' })).toHaveClass('w-12');
  });
});
