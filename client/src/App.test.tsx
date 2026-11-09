import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { crashShell, reportingConfig, reportError, setSamplePercent } = vi.hoisted(() => ({
  crashShell: { enabled: false },
  reportingConfig: { ready: true, samplePercent: 100 },
  reportError: vi.fn(),
  setSamplePercent: vi.fn(),
}));
// Reading a malformed config (clientErrors: null) crashes its reader, as a real one did before useConfig's merge.
const crashConfig = vi.hoisted(() => ({ enabled: false }));
vi.mock('./lib/errorReporter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/errorReporter')>()),
  reportError,
  setSamplePercent,
}));
vi.mock('./features/config/useConfig', async () => {
  const { CONFIG_FALLBACK } = await import('./features/config/fallbacks');
  return {
    useConfig: () => ({
      ...CONFIG_FALLBACK,
      serverVersion: reportingConfig.ready ? '0.0.0' : 'unknown',
      clientErrors: crashConfig.enabled ? null : { samplePercent: reportingConfig.samplePercent },
    }),
  };
});
vi.mock('./components/TopBar', async (importOriginal) => {
  const { TopBar } = await importOriginal<typeof import('./components/TopBar')>();
  return {
    TopBar: (props: Parameters<typeof TopBar>[0]) => {
      if (crashShell.enabled) throw new Error('Shell crashed');
      return <TopBar {...props} />;
    },
  };
});

vi.mock('./lib/supabase', () => ({
  getSupabase: () => new Promise(() => {}),
  mayHaveSession: () => false,
}));

const { default: App } = await import('./App');
const { getShellConfig } = await import('./appShell');

function go(path: string) {
  act(() => {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
}

describe('App shell on navigation', () => {
  beforeEach(() => {
    reportingConfig.ready = true;
    reportingConfig.samplePercent = 100;
    window.scrollTo = vi.fn() as typeof window.scrollTo;
    window.history.pushState({}, '', '/nowhere');
  });

  it('does not enable startup reporting from fallback config before a delayed zero-percent setting arrives', () => {
    reportingConfig.ready = false;
    setSamplePercent.mockClear();
    const { rerender } = render(<App />);
    expect(setSamplePercent).not.toHaveBeenCalled();
    reportingConfig.ready = true;
    reportingConfig.samplePercent = 0;
    rerender(<App />);
    expect(setSamplePercent).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('catches a shell crash and still configures reporting', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const preventError = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener('error', preventError);
    crashShell.enabled = true;
    reportError.mockClear();
    setSamplePercent.mockClear();
    try {
      render(<App />);
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
      expect(reportError).toHaveBeenCalledExactlyOnceWith(expect.any(Error), 'render');
      expect(setSamplePercent).toHaveBeenCalledWith(100);
    } finally {
      crashShell.enabled = false;
      window.removeEventListener('error', preventError);
    }
  });

  // Read above the app boundary, a malformed config once left a blank white page.
  it('catches a crash while reading the config and still renders the shell', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const preventError = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener('error', preventError);
    crashConfig.enabled = true;
    try {
      render(<App />);
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      expect(screen.getAllByText('Page not found').length).toBeGreaterThan(0);
    } finally {
      crashConfig.enabled = false;
      window.removeEventListener('error', preventError);
    }
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

afterEach(() => vi.restoreAllMocks());

describe('shell by route', () => {
  it('the customer tabs show on customer screens and never on the operator ones', () => {
    for (const path of ['/', '/menu', '/orders', '/orders/o1', '/profile'])
      expect(getShellConfig(path).bottomNav, path).toBe(true);
    for (const path of ['/admin', '/staff'])
      expect(getShellConfig(path).bottomNav, path).toBe(false);
  });
});
