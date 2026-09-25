import type { PaymentStatus } from '../types/enums';

/**
 * V0 payment: every payment succeeds instantly, no gateway involved.
 *
 * This is the one seam for real payments later (create intent, confirm, verify):
 * order.service only depends on the PaymentStatus this function resolves to.
 */
export async function simulatePayment(amountInRupees: number): Promise<PaymentStatus> {
  if (amountInRupees <= 0) throw new Error('Payment amount must be positive.');
  return 'PAID';
}
