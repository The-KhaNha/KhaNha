import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Store } from '../../types/api';
import { ApiError } from '../../services/api';

const api = vi.hoisted(() => ({ pauseStore: vi.fn(), resumeStore: vi.fn() }));
vi.mock('../../services/stores', () => api);
const { PauseControl } = await import('./PauseControl');

const open = { id: 's1', openState: 'OPEN', isOpen: true, nextChangeAt: null } as Store;

function Harness({ initial }: { initial: Store }) {
  const [store, setStore] = useState(initial);
  return <PauseControl storeId="s1" store={store} mutate={(fn) => setStore(fn)} />;
}

describe('PauseControl', () => {
  // The pressed button leaves the screen each time: focus must stay in the control, never fall back to the page.
  it('keeps keyboard focus in the control as its buttons change', async () => {
    api.pauseStore.mockReset().mockReturnValue(new Promise<Store>(() => {}));
    render(<Harness initial={open} />);
    const pauseButton = screen.getByRole('button', { name: 'Pause orders' });
    pauseButton.focus();
    fireEvent.click(pauseButton);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '15 min' }));
    fireEvent.click(screen.getByRole('button', { name: '15 min' }));
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.getByRole('group', { name: 'Pause new orders' })).toContainElement(
      document.activeElement as HTMLElement,
    );
  });

  it('shows the pause at once, then Resume brings the store back', async () => {
    let settle: (s: Store) => void = () => {};
    api.pauseStore.mockReturnValue(new Promise<Store>((r) => (settle = r)));
    render(<Harness initial={open} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause orders' }));
    fireEvent.click(screen.getByRole('button', { name: '30 min' }));
    expect(screen.getByRole('status')).toHaveTextContent('Orders paused · 30 min left');
    expect(api.pauseStore).toHaveBeenCalledWith('s1', { minutes: 30 });
    settle({
      ...open,
      openState: 'PAUSED',
      nextChangeAt: new Date(Date.now() + 1_800_000).toISOString(),
    });

    api.resumeStore.mockResolvedValue(open);
    const resume = await screen.findByRole('button', { name: 'Resume' });
    await waitFor(() => expect(resume).toBeEnabled());
    fireEvent.click(resume);
    expect(await screen.findByRole('button', { name: 'Pause orders' })).toBeInTheDocument();
  });

  it('allows no Resume until the pause answered, so a late answer cannot undo it', () => {
    api.pauseStore.mockReset().mockReturnValue(new Promise<Store>(() => {}));
    api.resumeStore.mockReset();
    render(<Harness initial={open} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause orders' }));
    fireEvent.click(screen.getByRole('button', { name: '15 min' }));
    const resume = screen.getByRole('button', { name: 'Resume' });
    expect(resume).toBeDisabled();
    fireEvent.click(resume);
    expect(api.resumeStore).not.toHaveBeenCalled();
  });

  it('rolls back and says so when the request fails', async () => {
    api.pauseStore.mockRejectedValue(new ApiError(500, 'INTERNAL', 'Could not pause.'));
    render(<Harness initial={open} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause orders' }));
    fireEvent.click(screen.getByRole('button', { name: 'Until I resume' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not pause.');
    expect(screen.getByRole('button', { name: 'Pause orders' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says so and offers a retry when the store could not be loaded', () => {
    const retry = vi.fn();
    render(<PauseControl storeId="s1" mutate={() => {}} loadFailed onRetry={retry} />);
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load the store");
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('asks the store again when a change got no answer', async () => {
    api.pauseStore.mockReset().mockRejectedValue(new ApiError(0, 'UNREACHABLE', 'offline'));
    const retry = vi.fn();
    render(<PauseControl storeId="s1" store={open} mutate={() => {}} onRetry={retry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause orders' }));
    fireEvent.click(screen.getByRole('button', { name: '15 min' }));
    await waitFor(() => expect(retry).toHaveBeenCalledOnce());
  });
});
