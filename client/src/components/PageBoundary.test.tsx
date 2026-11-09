import { Suspense } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../lib/logger';
import { PageBoundary } from './PageBoundary';

const reportError = vi.hoisted(() => vi.fn());
vi.mock('../lib/errorReporter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/errorReporter')>()),
  reportError,
}));
const preventError = (event: ErrorEvent) => event.preventDefault();
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  window.addEventListener('error', preventError);
  reportError.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  window.removeEventListener('error', preventError);
});

function Thrower(): never {
  throw new Error('chunk load failed');
}

describe('PageBoundary', () => {
  it('renders its children when nothing fails', () => {
    render(
      <PageBoundary>
        <p>Page content</p>
      </PageBoundary>,
    );
    expect(screen.getByText('Page content')).toBeInTheDocument();
  });

  it('shows the unreachable retry state when a lazy child throws', () => {
    // React (console.error) and jsdom (a window "error" event) both report the caught throw; the
    // assertion is on the fallback UI, not the noise.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onWindowError = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener('error', onWindowError);
    render(
      <PageBoundary>
        <Thrower />
      </PageBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText("This page didn't load")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(reportError).not.toHaveBeenCalled();
    window.removeEventListener('error', onWindowError);
    consoleError.mockRestore();
  });

  it('reports a render bug once and offers Reload with accurate copy', () => {
    const error = new Error('Cannot read properties of undefined');
    function Crash(): never {
      throw error;
    }
    render(
      <PageBoundary>
        <Crash />
      </PageBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.queryByText(/couldn't reach the server/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(reportError).toHaveBeenCalledExactlyOnceWith(error, 'render');
  });

  it.each([
    'Failed to fetch dynamically imported module: /assets/page.js',
    'Importing a module script failed.',
    'error loading dynamically imported module',
  ])('keeps chunk failures unreachable (%s)', (message) => {
    function Crash(): never {
      throw new TypeError(message);
    }
    render(
      <PageBoundary>
        <Crash />
      </PageBoundary>,
    );
    expect(screen.getByText("This page didn't load")).toBeInTheDocument();
    expect(reportError).not.toHaveBeenCalled();
  });

  it('app scope leaves suspense to the page and has no skeleton', () => {
    function Pending(): never {
      throw new Promise(() => {});
    }
    render(
      <Suspense fallback={<p>Outer fallback</p>}>
        <PageBoundary scope="app">
          <Pending />
        </PageBoundary>
      </Suspense>,
    );
    expect(screen.getByText('Outer fallback')).toBeInTheDocument();
  });

  // A malformed response that useResource persisted would crash every later visit before the fresh fetch replaced it.
  it('drops the persisted cache on a render crash so Reload recovers, and keeps it for a chunk failure', () => {
    function Crash({ message }: { message: string }): never {
      throw new TypeError(message);
    }
    localStorage.setItem('fp_cache:v1:menu', '{"categories":null}');
    const chunk = render(
      <PageBoundary>
        <Crash message="Failed to fetch dynamically imported module: /assets/page.js" />
      </PageBoundary>,
    );
    expect(localStorage.getItem('fp_cache:v1:menu')).not.toBeNull();
    chunk.unmount();
    render(
      <PageBoundary>
        <Crash message="Cannot read properties of null (reading 'map')" />
      </PageBoundary>,
    );
    expect(localStorage.getItem('fp_cache:v1:menu')).toBeNull();
    localStorage.clear();
  });

  // A render crash left no trace in the console at warn level; the message and stack stay out (they may hold PII).
  it('logs a render crash with its scope only', () => {
    const logError = vi.spyOn(logger, 'error').mockImplementation(() => {});
    function Crash(): never {
      throw new Error('Cannot read properties of undefined (reading anishka@example.com)');
    }
    render(
      <PageBoundary scope="app">
        <Crash />
      </PageBoundary>,
    );
    expect(logError).toHaveBeenCalledExactlyOnceWith('Page render failed', { scope: 'app' });
  });

  it('silent renders nothing on a crash but still reports it', () => {
    const error = new Error('Cannot read properties of null');
    function Crash(): never {
      throw error;
    }
    const { container } = render(
      <PageBoundary scope="app" silent>
        <Crash />
      </PageBoundary>,
    );
    expect(container).toBeEmptyDOMElement();
    expect(reportError).toHaveBeenCalledExactlyOnceWith(error, 'render');
  });
});
