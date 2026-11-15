import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useLeaveWarning } from './useLeaveWarning';

const leave = () => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

describe('useLeaveWarning', () => {
  it('asks before a reload only while there are unsaved edits', () => {
    const { rerender, unmount } = renderHook(({ dirty }) => useLeaveWarning(dirty), {
      initialProps: { dirty: false },
    });
    expect(leave()).toBe(false);
    rerender({ dirty: true });
    expect(leave()).toBe(true);
    rerender({ dirty: false });
    expect(leave()).toBe(false);
    rerender({ dirty: true });
    unmount();
    expect(leave()).toBe(false);
  });
});
