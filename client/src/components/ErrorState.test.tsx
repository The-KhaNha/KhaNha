import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useVersionStore } from '../features/version/versionStore';
import { ErrorState } from './ErrorState';

describe('ErrorState action', () => {
  afterEach(() => {
    useVersionStore.setState({ outdated: false });
    vi.unstubAllGlobals();
  });

  it('retries normally', () => {
    const onRetry = vi.fn();
    render(<ErrorState title="Unable to load your orders." onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('offers Refresh instead of a retry that can only fail again once the build is outdated', () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    useVersionStore.setState({ outdated: true });
    const onRetry = vi.fn();
    render(<ErrorState title="Unable to load your orders." onRetry={onRetry} />);
    expect(screen.queryByRole('button', { name: 'Try Again' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('offers Refresh when outdated even where the page gave no retry', () => {
    useVersionStore.setState({ outdated: true });
    render(<ErrorState title="Unable to load the menu." />);
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  it('offers Reload for CLIENT_RELOAD_REQUIRED, even where the page gave no retry', () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    render(<ErrorState title="Your order didn't go through." code="CLIENT_RELOAD_REQUIRED" />);
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // A failed sign-in chunk once turned every ErrorState into Reload, the public menu's too, which needs no sign-in.
  it('keeps Try Again for an unrelated error after the sign-in code failed to load', () => {
    const onRetry = vi.fn();
    render(<ErrorState title="Unable to load the menu." code="UNREACHABLE" onRetry={onRetry} />);
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
