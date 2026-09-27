import {
  ChefHat,
  CircleCheck,
  CircleX,
  PackageCheck,
  ReceiptText,
  type LucideIcon,
} from 'lucide-react';
import type { Order, OrderStatus } from '../../types/api';

/** The happy path, in order. CANCELLED sits outside the flow. */
export const ORDER_STEPS: readonly OrderStatus[] = ['PLACED', 'PREPARING', 'READY', 'COMPLETED'];

export const TERMINAL_STATUSES: readonly OrderStatus[] = ['COMPLETED', 'CANCELLED'];

export interface StatusMeta {
  /** Short label for badges and staff filters. */
  label: string;
  /** Headline shown to the customer on the tracking page. */
  customerTitle: string;
  /** Supporting line shown to the customer. */
  customerCopy: string;
  icon: LucideIcon;
  /** Badge classes: tinted background + text colour (all pairs meet AA). */
  badgeClass: string;
  /** Solid fill (dots, active tracker step, strip icon disc). */
  fillClass: string;
  /** Icon/text colour that sits on `fillClass` (gold needs ink, everything else white). */
  onFillClass: string;
  /** 4px left rail on staff cards. */
  railClass: string;
  /** "r g b" for the pulse-soft ring around the active tracker step. */
  pulseRgb: string;
  /** The next status on the happy path, if any. */
  next: OrderStatus | null;
  /** Label for the staff's single primary action. */
  actionLabel: string | null;
  /** Whether staff may cancel from this status. */
  canCancel: boolean;
}

/*
 * Colour system: PLACED = paprika, PREPARING = saffron gold, READY = basil green,
 * COMPLETED = warm neutral, CANCELLED = cool slate (red never means "cancelled" in a red brand).
 */
export const STATUS_META: Record<OrderStatus, StatusMeta> = {
  PLACED: {
    label: 'Placed',
    customerTitle: 'Order received',
    customerCopy: "We've got your order. The kitchen will pick it up shortly.",
    icon: ReceiptText,
    badgeClass: 'bg-brand-50 text-brand-700',
    fillClass: 'bg-brand-500',
    onFillClass: 'text-white',
    railClass: 'bg-brand-500',
    pulseRgb: '209 55 17',
    next: 'PREPARING',
    actionLabel: 'Start Preparing',
    canCancel: true,
  },
  PREPARING: {
    label: 'Preparing',
    customerTitle: 'Being prepared',
    customerCopy: 'Your order is being made fresh right now.',
    icon: ChefHat,
    badgeClass: 'bg-gold-50 text-gold-700',
    fillClass: 'bg-gold-500',
    onFillClass: 'text-ink',
    railClass: 'bg-gold-500',
    pulseRgb: '245 166 35',
    next: 'READY',
    actionLabel: 'Mark Ready',
    canCancel: true,
  },
  READY: {
    label: 'Ready',
    customerTitle: 'Ready for pickup',
    customerCopy: 'Head to the pickup counter and tell the staff your order number.',
    icon: PackageCheck,
    badgeClass: 'bg-success-50 text-success-700',
    fillClass: 'bg-success-500',
    onFillClass: 'text-white',
    railClass: 'bg-success-500',
    pulseRgb: '21 128 61',
    next: 'COMPLETED',
    actionLabel: 'Complete Order',
    canCancel: false,
  },
  COMPLETED: {
    label: 'Completed',
    customerTitle: 'Picked up',
    customerCopy: 'Picked up successfully. Enjoy your order!',
    icon: CircleCheck,
    badgeClass: 'bg-surface-2 text-complete-700',
    fillClass: 'bg-complete-500',
    onFillClass: 'text-white',
    railClass: 'bg-complete-500',
    pulseRgb: '181 165 151',
    next: null,
    actionLabel: null,
    canCancel: false,
  },
  CANCELLED: {
    label: 'Cancelled',
    customerTitle: 'Cancelled',
    customerCopy: "This order was cancelled. You weren't charged for anything else.",
    icon: CircleX,
    badgeClass: 'bg-cancel-50 text-cancel-700',
    fillClass: 'bg-cancel-500',
    onFillClass: 'text-white',
    railClass: 'bg-cancel-500',
    pulseRgb: '100 116 139',
    next: null,
    actionLabel: null,
    canCancel: false,
  },
};

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function isActive(status: OrderStatus): boolean {
  return !isTerminal(status);
}

/** Index of the status within the happy path, or -1 for CANCELLED. */
export function stepIndex(status: OrderStatus): number {
  return ORDER_STEPS.indexOf(status);
}

/** Staff dashboard filter tabs. */
export type StaffFilterKey = 'ALL' | 'NEW' | 'PREPARING' | 'READY' | 'COMPLETED';

export interface StaffFilter {
  key: StaffFilterKey;
  label: string;
  /** null = every order */
  statuses: readonly OrderStatus[] | null;
}

export const STAFF_FILTERS: readonly StaffFilter[] = [
  { key: 'ALL', label: 'All', statuses: null },
  { key: 'NEW', label: 'New', statuses: ['PLACED'] },
  { key: 'PREPARING', label: 'Preparing', statuses: ['PREPARING'] },
  { key: 'READY', label: 'Ready', statuses: ['READY'] },
  { key: 'COMPLETED', label: 'Completed', statuses: ['COMPLETED', 'CANCELLED'] },
];

export function matchesFilter(status: OrderStatus, filter: StaffFilter): boolean {
  return filter.statuses === null || filter.statuses.includes(status);
}

/** "Total paid" only when the money actually landed and stayed: paid and not cancelled. */
export function amountLabel(order: Pick<Order, 'status' | 'paymentStatus'>): string {
  return order.paymentStatus === 'PAID' && order.status !== 'CANCELLED' ? 'Total paid' : 'Total';
}

interface TimelineLabel {
  label: string;
  iso: string;
}

/** The one time that matters now: the ETA while it's being made, when it became ready, when it was picked up. */
export function timelineLabel(
  order: Pick<Order, 'status' | 'estimatedReadyAt' | 'updatedAt' | 'createdAt'>,
): TimelineLabel {
  switch (order.status) {
    case 'READY':
      return { label: 'Ready since', iso: order.updatedAt };
    case 'COMPLETED':
      return { label: 'Picked up', iso: order.updatedAt };
    case 'CANCELLED':
      return { label: 'Placed', iso: order.createdAt };
    default:
      return { label: 'Estimated ready', iso: order.estimatedReadyAt };
  }
}
