import { describe, expect, it } from 'vitest';
import {
  STAFF_FILTERS,
  amountLabel,
  isActive,
  isTerminal,
  matchesFilter,
  stepIndex,
  timelineLabel,
} from './orderStatus';
import type { Order, OrderStatus } from '../../types/api';

describe('isTerminal / isActive', () => {
  it('COMPLETED and CANCELLED are terminal', () => {
    expect(isTerminal('COMPLETED')).toBe(true);
    expect(isTerminal('CANCELLED')).toBe(true);
    expect(isActive('COMPLETED')).toBe(false);
  });

  it('PLACED, PREPARING and READY are active', () => {
    for (const status of ['PLACED', 'PREPARING', 'READY'] as OrderStatus[]) {
      expect(isTerminal(status)).toBe(false);
      expect(isActive(status)).toBe(true);
    }
  });
});

describe('stepIndex', () => {
  it('locates PLACED..COMPLETED on the happy path', () => {
    expect(stepIndex('PLACED')).toBe(0);
    expect(stepIndex('PREPARING')).toBe(1);
    expect(stepIndex('READY')).toBe(2);
    expect(stepIndex('COMPLETED')).toBe(3);
  });

  it('is -1 for CANCELLED (outside the happy path)', () => {
    expect(stepIndex('CANCELLED')).toBe(-1);
  });
});

describe('matchesFilter', () => {
  function filter(key: (typeof STAFF_FILTERS)[number]['key']) {
    const found = STAFF_FILTERS.find((f) => f.key === key);
    if (!found) throw new Error(`missing staff filter: ${key}`);
    return found;
  }
  const all = filter('ALL');
  const newFilter = filter('NEW');
  const preparing = filter('PREPARING');
  const ready = filter('READY');
  const completed = filter('COMPLETED');

  it('ALL matches every status', () => {
    for (const status of [
      'PLACED',
      'PREPARING',
      'READY',
      'COMPLETED',
      'CANCELLED',
    ] as OrderStatus[]) {
      expect(matchesFilter(status, all)).toBe(true);
    }
  });

  it('NEW / PREPARING / READY match only their own status', () => {
    expect(matchesFilter('PLACED', newFilter)).toBe(true);
    expect(matchesFilter('PREPARING', newFilter)).toBe(false);
    expect(matchesFilter('PREPARING', preparing)).toBe(true);
    expect(matchesFilter('READY', ready)).toBe(true);
    expect(matchesFilter('READY', preparing)).toBe(false);
  });

  it('COMPLETED groups both COMPLETED and CANCELLED', () => {
    expect(matchesFilter('COMPLETED', completed)).toBe(true);
    expect(matchesFilter('CANCELLED', completed)).toBe(true);
    expect(matchesFilter('PLACED', completed)).toBe(false);
  });
});

function order(
  overrides: Partial<Order> = {},
): Pick<Order, 'status' | 'paymentStatus' | 'estimatedReadyAt' | 'updatedAt' | 'createdAt'> {
  return {
    status: 'PLACED',
    paymentStatus: 'PAID',
    estimatedReadyAt: '2026-09-26T10:15:00.000Z',
    updatedAt: '2026-09-26T10:05:00.000Z',
    createdAt: '2026-09-26T10:00:00.000Z',
    ...overrides,
  };
}

describe('amountLabel', () => {
  it('"Total paid" when paid and not cancelled', () => {
    expect(amountLabel(order({ status: 'READY', paymentStatus: 'PAID' }))).toBe('Total paid');
  });

  it('"Total" when cancelled, even if paid', () => {
    expect(amountLabel(order({ status: 'CANCELLED', paymentStatus: 'PAID' }))).toBe('Total');
  });

  it('"Total" when not paid', () => {
    expect(amountLabel(order({ status: 'PLACED', paymentStatus: 'PENDING' }))).toBe('Total');
  });
});

describe('timelineLabel', () => {
  it('READY -> "Ready since" at updatedAt', () => {
    expect(timelineLabel(order({ status: 'READY' }))).toEqual({
      label: 'Ready since',
      iso: '2026-09-26T10:05:00.000Z',
    });
  });

  it('COMPLETED -> "Picked up" at updatedAt', () => {
    expect(timelineLabel(order({ status: 'COMPLETED' }))).toEqual({
      label: 'Picked up',
      iso: '2026-09-26T10:05:00.000Z',
    });
  });

  it('CANCELLED -> "Placed" at createdAt', () => {
    expect(timelineLabel(order({ status: 'CANCELLED' }))).toEqual({
      label: 'Placed',
      iso: '2026-09-26T10:00:00.000Z',
    });
  });

  it('PLACED / PREPARING -> "Estimated ready" at estimatedReadyAt', () => {
    expect(timelineLabel(order({ status: 'PLACED' }))).toEqual({
      label: 'Estimated ready',
      iso: '2026-09-26T10:15:00.000Z',
    });
    expect(timelineLabel(order({ status: 'PREPARING' }))).toEqual({
      label: 'Estimated ready',
      iso: '2026-09-26T10:15:00.000Z',
    });
  });
});
