import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./lib/supabase', () => ({
  getSupabase: () => new Promise(() => {}),
  mayHaveSession: () => false,
}));

const { default: App } = await import('./App');

function go(path: string) {
  act(() => {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
}

describe('App shell on navigation', () => {
  beforeEach(() => {
    window.scrollTo = vi.fn() as typeof window.scrollTo;
    window.history.pushState({}, '', '/nowhere');
  });

  it('titles the tab after the page, announces it, and moves focus only after the first page', async () => {
    render(<App />);
    expect(document.title).toBe('Page not found · Food Pickup');
    expect(document.body).toHaveFocus();

    go('/also-nowhere');
    expect(screen.getAllByText('Page not found').length).toBeGreaterThan(0);
    const live = document.querySelector('[aria-live="polite"]');
    expect(live).toHaveTextContent('Page not found');
    expect(live?.parentElement).toHaveFocus();
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it('uses the bare app name as the title on the home page', () => {
    window.history.pushState({}, '', '/');
    render(<App />);
    expect(document.title).toBe('Food Pickup');
  });
});
