import type { PaymentStatus } from '../types/enums';
import { AppError } from '../utils/errors';

/**
 * V0 payment: every payment succeeds instantly, no gateway involved.
 *
 * This is the one seam for real payments later (create intent, confirm, verify):
 * order.service only depends on the PaymentStatus this function resolves to.
 */
export async function simulatePayment(amountPaise: number): Promise<PaymentStatus> {
  // Unreachable while menu_items.price_paise > 0 (CHECK); a 400, never a 500, if a free item ever gets through.
  if (amountPaise <= 0)
    throw new AppError(400, 'BAD_REQUEST', 'The order total must be more than ₹0.');
  return 'PAID';
}
