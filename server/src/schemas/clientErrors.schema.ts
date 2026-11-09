import { z } from 'zod';
import { LIMITS } from './limits';

const {
  reportsMax: REPORTS_MAX,
  messageMax: MESSAGE_MAX,
  stackMax: STACK_MAX,
  routeMax: ROUTE_MAX,
} = LIMITS.clientErrors;
// What a route may be before its query string and hash are dropped: an auth callback's hash carries a JWT of ~1 KB.
const ROUTE_INPUT_MAX = 4000;

// REDACT_PATHS blanks log fields by key, never inside a string, and an error message can quote a header, a URL or a
// form value it was handed. Over-redacting a client report costs nothing, so each shape is matched loosely:
// - a JWT, even cut short: its header always encodes to `eyJ`, and the payload holds the email and role;
// - a Supabase `sb_…` key, also inside a longer name (`x_sb_secret_…`), and a `Bearer` value;
// - a token, code or password in a URL parameter (`#access_token=…&refresh_token=…`: the refresh token is no JWT), also
//   with its `=` encoded (`refresh_token%3D…` inside an encoded `next=` URL). No `\b` before the name: in
//   `%23refresh_token` the `3` is a word character, and catching `barcode=` too costs nothing;
// - an email address, also URL-encoded (`%40`, `%2B`) or with an apostrophe (`o'brien@…`); it and the JWT only start at
//   the head of a run (lookbehind), and its parts are bounded (RFC 5321), so a long run cannot make the scan quadratic.
//   A `%` or `'` may sit inside the local part but still starts a new run: an encoded email at the end of an encoded
//   URL follows far more than 64 joined characters, and only a start after a `%` reaches it;
// - a phone number: 10 to 15 digits with up to three spaces, dashes, dots, slashes or parentheses between each two
//   (`+91 - 98765 - 43210`, `98765/43210`; an epoch timestamp too). A date, a time or an order number has under 10.
const SECRET_SHAPED = new RegExp(
  [
    String.raw`(?<![\w-])eyJ[\w-]+(?:\.[\w-]*){0,2}`,
    String.raw`\bsb_[a-z]+_[\w-]+|sb_(?:secret|publishable)_[\w-]+`,
    String.raw`\bBearer\s+[\w.~+/=-]+`,
    String.raw`(?:access_token|refresh_token|provider_token|provider_refresh_token|token|code|password)(?:=|%3D)[^&\s#"']+`,
    String.raw`(?<![\w.+-])[\w.+%'-]{1,64}(?:@|%40)[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}`,
    String.raw`\+?\(?\d(?:[\s.()/-]{0,3}\d){9,14}`,
  ].join('|'),
  'gi',
);

/** Replaces anything shaped like a token, key, email or phone; the client scrubs too, this is the server's own guard. */
function scrubSecrets(text: string): string {
  return text.replace(SECRET_SHAPED, '[Redacted]');
}

const scrubbed = (max: number) => z.string().max(max).transform(scrubSecrets);

// A route is a path. Its query string or hash can carry a token (Supabase's auth redirect puts `#access_token=…` in the
// URL), so both are dropped first, then the rest is scrubbed and cut to ROUTE_MAX: a long callback URL must not turn
// the whole batch into a 400.
const route = z
  .string()
  .max(ROUTE_INPUT_MAX)
  .transform((value) => scrubSecrets(value.replace(/[?#][\s\S]*$/, '')).slice(0, ROUTE_MAX));

const clientErrorReport = z.strictObject({
  kind: z.enum(['error', 'unhandledrejection', 'render']),
  message: scrubbed(MESSAGE_MAX),
  stack: scrubbed(STACK_MAX).optional(),
  route,
  at: z.iso.datetime({ offset: true }),
});

export const clientErrorsSchema = z.strictObject({
  reports: z.array(clientErrorReport).min(1).max(REPORTS_MAX),
});

export type ClientErrorsInput = z.infer<typeof clientErrorsSchema>;
