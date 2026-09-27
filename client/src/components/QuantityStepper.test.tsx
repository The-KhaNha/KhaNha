import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { QuantityStepper, StepperNote } from './QuantityStepper';

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

describe('QuantityStepper at the 10-per-order cap', () => {
  it('labels the plus "Maximum 10 reached" and marks it aria-disabled once quantity hits max=10', () => {
    render(
      <QuantityStepper
        quantity={10}
        onIncrement={() => {}}
        onDecrement={() => {}}
        max={10}
        tone="neutral"
      />,
    );
    const plus = screen.getByRole('button', { name: 'Maximum 10 reached' });
    expect(plus).toHaveAttribute('aria-disabled', 'true');
  });

  it('still says "Increase quantity" below the cap', () => {
    render(
      <QuantityStepper
        quantity={9}
        onIncrement={() => {}}
        onDecrement={() => {}}
        max={10}
        tone="neutral"
      />,
    );
    expect(screen.getByRole('button', { name: 'Increase quantity' })).not.toHaveAttribute(
      'aria-disabled',
    );
  });
});

describe('StepperNote', () => {
  it('reads "Max 10 per order" with no stock limit', () => {
    render(<StepperNote maxQuantity={null} />);
    expect(screen.getByText('Max 10 per order')).toBeInTheDocument();
  });

  it('names the stock left instead, when it is below the cap', () => {
    render(<StepperNote maxQuantity={3} />);
    expect(screen.getByText('Only 3 available')).toBeInTheDocument();
  });
});
