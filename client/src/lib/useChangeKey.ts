import { useLayoutEffect, useRef, useState } from 'react';

export interface ChangeKey {
  /** Increments every time `value` changes. Use as a React `key` to replay a CSS animation. */
  key: number;
  /** 1 when the value went up, -1 when it went down (numbers only; 1 otherwise). */
  direction: 1 | -1;
}

/**
 * Re-keys an element whenever a value changes so its mount animation plays again
 * (counter rolls, badge pops). Runs in a layout effect so the remount happens before paint.
 */
export function useChangeKey(value: number | string | boolean): ChangeKey {
  const [state, setState] = useState<ChangeKey>({ key: 0, direction: 1 });
  const previous = useRef(value);

  useLayoutEffect(() => {
    if (Object.is(previous.current, value)) return;
    const direction: 1 | -1 =
      typeof value === 'number' && typeof previous.current === 'number' && value < previous.current
        ? -1
        : 1;
    previous.current = value;
    setState((s) => ({ key: s.key + 1, direction }));
  }, [value]);

  return state;
}
