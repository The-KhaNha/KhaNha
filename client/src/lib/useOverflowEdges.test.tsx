import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOverflowEdges } from './useOverflowEdges';

let resizeCallback: (() => void) | undefined;
const disconnect = vi.fn();

beforeEach(() => {
  disconnect.mockClear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: () => void) {
        resizeCallback = cb;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

function Row() {
  const { ref, edges, onScroll } = useOverflowEdges<HTMLDivElement>();
  return (
    <div ref={ref} onScroll={onScroll} data-testid="row">
      {String(edges.left)}/{String(edges.right)}
    </div>
  );
}

function measure(
  el: HTMLElement,
  m: { scrollWidth: number; clientWidth: number; scrollLeft: number },
) {
  Object.defineProperty(el, 'scrollWidth', { value: m.scrollWidth, configurable: true });
  Object.defineProperty(el, 'clientWidth', { value: m.clientWidth, configurable: true });
  el.scrollLeft = m.scrollLeft;
}

describe('useOverflowEdges', () => {
  it('reports no edge when the content fits', () => {
    render(<Row />);
    const row = screen.getByTestId('row');
    measure(row, { scrollWidth: 300, clientWidth: 300, scrollLeft: 0 });
    act(() => resizeCallback?.());
    expect(row).toHaveTextContent('false/false');
  });

  it('shows the right edge at the start of an overflowing row, both mid-way, only the left at the end', () => {
    render(<Row />);
    const row = screen.getByTestId('row');
    measure(row, { scrollWidth: 600, clientWidth: 300, scrollLeft: 0 });
    act(() => resizeCallback?.());
    expect(row).toHaveTextContent('false/true');

    measure(row, { scrollWidth: 600, clientWidth: 300, scrollLeft: 100 });
    act(() => {
      row.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    expect(row).toHaveTextContent('true/true');

    measure(row, { scrollWidth: 600, clientWidth: 300, scrollLeft: 300 });
    act(() => {
      row.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    expect(row).toHaveTextContent('true/false');
  });

  it('counts an edge within 4px as reached (sub-pixel scroll positions)', () => {
    render(<Row />);
    const row = screen.getByTestId('row');
    measure(row, { scrollWidth: 600, clientWidth: 300, scrollLeft: 4 });
    act(() => resizeCallback?.());
    expect(row).toHaveTextContent('false/true');
    measure(row, { scrollWidth: 600, clientWidth: 300, scrollLeft: 297 });
    act(() => resizeCallback?.());
    expect(row).toHaveTextContent('true/false');
  });

  it('re-measures on window resize and disconnects the observer on unmount', () => {
    const { unmount } = render(<Row />);
    const row = screen.getByTestId('row');
    measure(row, { scrollWidth: 600, clientWidth: 300, scrollLeft: 0 });
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(row).toHaveTextContent('false/true');
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });
});
