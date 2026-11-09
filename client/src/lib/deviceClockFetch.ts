/**
 * supabase-js's fetch, with each issued token's `expires_at` restated on this device's clock. supabase-js compares the
 * server's `expires_at` with `Date.now()`, so a phone clock an hour or more fast saw every token as expired: it
 * refreshed on every call, and one refused refresh signed the user out. Measured from `expires_in` on the device's own
 * clock instead, the token lives its real length here; the API's JWKS check still enforces the true expiry.
 */
export async function deviceClockFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, init);
  const url = input instanceof Request ? input.url : String(input);
  if (!response.ok || !new URL(url, window.location.href).pathname.endsWith('/auth/v1/token')) {
    return response;
  }
  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }
  if (typeof body !== 'object' || body === null) return response;
  const { expires_in: expiresIn } = body as { expires_in?: unknown };
  if (typeof expiresIn !== 'number') return response;
  return new Response(
    JSON.stringify({ ...body, expires_at: Math.floor(Date.now() / 1000) + expiresIn }),
    { status: response.status, statusText: response.statusText, headers: response.headers },
  );
}
