import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LazyGroup } from './LazyGroup';

// An IntersectionObserver the test drives: `near()` reports every observed group as near the screen.
let observed: Element[] = [];
let report: IntersectionObserverCallback = () => {};
class FakeObserver {
  constructor(callback: IntersectionObserverCallback) {
    report = callback;
  }
  observe(el: Element) {
    observed.push(el);
  }
  disconnect() {
    observed = [];
  }
}
const near = () =>
  act(() =>
    report(
      observed.map((target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry),
      {} as IntersectionObserver,
    ),
  );

afterEach(() => {
  vi.unstubAllGlobals();
  observed = [];
});

const card = () => <p>Masala Chai</p>;

describe('LazyGroup', () => {
  it('holds a placeholder until the group nears the screen, then mounts its cards and stops watching', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    const children = vi.fn(card);
    const { container } = render(<LazyGroup placeholderClassName="h-10">{children}</LazyGroup>);
    expect(screen.queryByText('Masala Chai')).toBeNull();
    expect(children).not.toHaveBeenCalled();
    expect(container.querySelector('[aria-hidden].h-10')).not.toBeNull();
    near();
    expect(screen.getByText('Masala Chai')).toBeInTheDocument();
    expect(observed).toEqual([]);
  });

  it('mounts at once when eager, or where IntersectionObserver does not exist', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    const { unmount } = render(
      <LazyGroup eager placeholderClassName="h-10">
        {card}
      </LazyGroup>,
    );
    expect(screen.getByText('Masala Chai')).toBeInTheDocument();
    unmount();
    vi.stubGlobal('IntersectionObserver', undefined);
    render(<LazyGroup placeholderClassName="h-10">{card}</LazyGroup>);
    expect(screen.getByText('Masala Chai')).toBeInTheDocument();
  });
});
