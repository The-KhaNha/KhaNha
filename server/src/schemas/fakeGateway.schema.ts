import { z } from 'zod';

export const fakeGatewayPageSchema = z.object({ gatewayOrderId: z.uuid() });

/** The three buttons on the fake's payment page. */
export const fakeGatewayOutcomeSchema = z.object({
  gatewayOrderId: z.uuid(),
  outcome: z.enum(['pay', 'fail', 'pending']),
});
