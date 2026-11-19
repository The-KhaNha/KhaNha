import type { Request, Response } from 'express';
import { fakeOrderForPage, setFakeOutcome } from '../integrations/payments/fake';
import type { GatewayPaymentStatus } from '../integrations/payments/port';
import { notFound } from '../utils/errors';

const STATUS_OF = { pay: 'PAID', fail: 'FAILED', pending: 'PENDING' } as const satisfies Record<
  string,
  GatewayPaymentStatus
>;

// Plain HTML with no script and no style, so the API's `default-src 'none'` CSP needs no exception. Only numbers and
// fixed words are interpolated, never anything a user typed.
const page = (id: string, amountPaise: number, status: GatewayPaymentStatus) => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fake payment</title></head>
<body>
<h1>Fake payment</h1>
<p>Not a real payment provider: no money moves. Amount ${amountPaise} paise. Status ${status}.</p>
<form method="post" action="/api/fake-gateway/${id}/pay"><button type="submit">Pay</button></form>
<form method="post" action="/api/fake-gateway/${id}/fail"><button type="submit">Fail</button></form>
<form method="post" action="/api/fake-gateway/${id}/pending"><button type="submit">Leave it pending</button></form>
</body>
</html>`;

export async function showFakeGatewayPage(req: Request, res: Response): Promise<void> {
  const id = req.params.gatewayOrderId as string;
  const order = await fakeOrderForPage(id);
  if (!order) throw notFound();
  res.type('html').send(page(id, order.amountPaise, order.status));
}

export async function setFakeGatewayOutcome(req: Request, res: Response): Promise<void> {
  const { gatewayOrderId, outcome } = req.params as {
    gatewayOrderId: string;
    outcome: keyof typeof STATUS_OF;
  };
  const result = await setFakeOutcome(gatewayOrderId, STATUS_OF[outcome]);
  if (!result) throw notFound();
  // 303: the browser follows with a GET, as it does after a real provider's page.
  res.redirect(303, result.returnUrl);
}
