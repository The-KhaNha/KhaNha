import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PageBoundary } from './PageBoundary';

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
    window.removeEventListener('error', onWindowError);
    consoleError.mockRestore();
  });
});
