import { describe, expect, it } from 'vitest';
import type { Order } from '../../types/api';
import { countByFilter, queueOrder, visibleActionErrors } from './staffBoardRules';

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

describe('queueOrder', () => {
  const order = (id: string, status: Order['status'], createdAt: string) =>
    ({ id, status, createdAt }) as Order;
  const ids = (orders: Order[]) => [...orders].sort(queueOrder).map((o) => o.id);

  it('puts active orders first, oldest first, then finished ones, newest first', () => {
    expect(
      ids([
        order('done-old', 'COLLECTED', '2026-01-01T08:00:00Z'),
        order('new-late', 'PLACED', '2026-01-01T10:00:00Z'),
        order('done-new', 'CANCELLED', '2026-01-01T09:00:00Z'),
        order('ready-early', 'READY', '2026-01-01T07:00:00Z'),
      ]),
    ).toEqual(['ready-early', 'new-late', 'done-new', 'done-old']);
  });

  it('treats equal times as a tie', () => {
    const t = '2026-01-01T08:00:00Z';
    expect(queueOrder(order('a', 'PLACED', t), order('b', 'PLACED', t))).toBe(0);
  });
});

describe('countByFilter', () => {
  const o = (status: Order['status']) => ({ status }) as Order;

  it('is all zeros for no orders', () => {
    expect(countByFilter([])).toEqual({ ALL: 0, NEW: 0, PREPARING: 0, READY: 0, COLLECTED: 0 });
  });

  it('counts each status in its chip, and collected plus cancelled together under Done', () => {
    const orders = [
      o('PLACED'),
      o('PLACED'),
      o('PREPARING'),
      o('READY'),
      o('COLLECTED'),
      o('CANCELLED'),
    ];
    expect(countByFilter(orders)).toEqual({
      ALL: 6,
      NEW: 2,
      PREPARING: 1,
      READY: 1,
      COLLECTED: 2,
    });
  });
});
