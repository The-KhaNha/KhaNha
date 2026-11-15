import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { IntegrationError } from '../src/utils/errors';
import { LOG_SERIALIZERS, REDACT_PATHS } from '../src/utils/logger';
import { api } from './setup/api';

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      done();
    },
  });
  return {
    lines,
    log: pino(
      { redact: { paths: REDACT_PATHS, censor: '[Redacted]' }, serializers: LOG_SERIALIZERS },
      stream,
    ),
  };
}

describe('logger redaction', () => {
  it('blanks auth headers, secrets and PII', () => {
    const { lines, log } = capture();
    log.info(
      {
        req: { headers: { authorization: 'Bearer abc', cookie: 'sb=1', 'user-agent': 'ua' } },
        body: { email: 'a@b.test', phone: '9999999999', password: 'pw', name: 'Ann' },
        session: { access_token: 't', refresh_token: 'r' },
        SUPABASE_SECRET_KEY: 'sb_secret_x',
      },
      'hello',
    );
    expect(lines[0]).toMatchObject({
      req: { headers: { authorization: '[Redacted]', cookie: '[Redacted]', 'user-agent': 'ua' } },
      body: { email: '[Redacted]', phone: '[Redacted]', password: '[Redacted]', name: 'Ann' },
      session: { access_token: '[Redacted]', refresh_token: '[Redacted]' },
      SUPABASE_SECRET_KEY: '[Redacted]',
    });
  });
});

const PAYMENT_AND_PICKUP_KEYS = [
  'signature',
  'checksum',
  'secret',
  'apiKey',
  'api_key',
  'key_secret',
  'webhookSecret',
  'webhook_secret',
  'vpa',
  'pickupCode',
  'pickup_code',
  'customerPhone',
  'customer_phone',
];

describe('logger redaction: payment and pickup keys', () => {
  it.each(PAYMENT_AND_PICKUP_KEYS)('blanks %s at the top level and one level down', (key) => {
    const { lines, log } = capture();
    log.info({ [key]: 'x', payment: { [key]: 'y' }, keep: 'z' }, 'hello');
    expect(lines[0]).toMatchObject({
      [key]: '[Redacted]',
      payment: { [key]: '[Redacted]' },
      keep: 'z',
    });
  });

  it('blanks an authorization header outside req (e.g. an outbound call)', () => {
    const { lines, log } = capture();
    log.info(
      { headers: { authorization: 'Bearer a' }, call: { headers: { authorization: 'b' } } },
      'x',
    );
    expect(lines[0]).toMatchObject({
      headers: { authorization: '[Redacted]' },
      call: { headers: { authorization: '[Redacted]' } },
    });
  });
});

describe('logger error serializer', () => {
  it('keeps the cause chain', () => {
    const { lines, log } = capture();
    const cause = Object.assign(new TypeError('fetch failed'), {
      cause: new Error('connect ECONNREFUSED 127.0.0.1:54321'),
    });
    log.error(
      { err: new IntegrationError('supabase', 'postgrest', true, { cause }) },
      'Request failed',
    );
    const err = lines[0]?.err as {
      message: string;
      cause?: { message: string; cause?: { message: string } };
    };
    expect(err.message).toBe('supabase postgrest failed');
    expect(err.cause?.message).toBe('fetch failed');
    expect(err.cause?.cause?.message).toContain('ECONNREFUSED');
  });
});

describe('request id', () => {
  it('echoes a plain caller id', async () => {
    const res = await api().get('/api/health').set('x-request-id', 'abc-123');
    expect(res.headers['x-request-id']).toBe('abc-123');
  });

  it('replaces a missing or unsafe id with a uuid', async () => {
    const uuid = /^[0-9a-f-]{36}$/;
    const missing = await api().get('/api/health');
    expect(missing.headers['x-request-id']).toMatch(uuid);
    const unsafe = await api()
      .get('/api/health')
      .set('x-request-id', '<script>' + 'x'.repeat(80));
    expect(unsafe.headers['x-request-id']).toMatch(uuid);
  });
});
