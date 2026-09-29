import { describe, expect, it } from 'vitest';
import { visibleActionErrors } from './staffBoardRules';

describe('visibleActionErrors', () => {
  const offline = { message: "We couldn't reach the server.", unreachable: true, at: 1_000 };
  const invalid = { message: 'Order #1012 is already Ready.', unreachable: false, at: 1_000 };

  it('shows both before the board has loaded again', () => {
    expect(visibleActionErrors({ a: offline, b: invalid }, 900)).toEqual({
      a: offline.message,
      b: invalid.message,
    });
    expect(visibleActionErrors({ a: offline }, null)).toEqual({ a: offline.message });
  });

  it('drops an unreachable error once the board loads after it, and keeps the others', () => {
    expect(visibleActionErrors({ a: offline, b: invalid }, 2_000)).toEqual({ b: invalid.message });
  });
});
