import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Card, cardClasses } from './Card';

describe('cardClasses', () => {
  it('is the card shape by default and the smaller tile radius on request', () => {
    expect(cardClasses()).toContain('rounded-card');
    expect(cardClasses()).not.toContain('rounded-tile');
    expect(cardClasses(undefined, 'tile')).toContain('rounded-tile');
    expect(cardClasses(undefined, 'tile')).not.toContain('rounded-card');
  });

  it('carries the same border, shadow and surface either way, and appends extra classes', () => {
    for (const shape of ['card', 'tile'] as const) {
      const classes = cardClasses('mt-3', shape).split(' ');
      expect(classes).toEqual(expect.arrayContaining(['border', 'shadow-card', 'bg-surface']));
      expect(classes).toContain('mt-3');
    }
  });

  it('matches what <Card> renders (default tone) apart from padding', () => {
    render(<Card data-testid="c" />);
    const rendered = screen.getByTestId('c').className.split(' ');
    for (const cls of cardClasses().split(' ')) expect(rendered).toContain(cls);
  });
});
