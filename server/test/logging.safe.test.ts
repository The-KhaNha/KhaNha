import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { queueFields } from '../src/jobs/health';
import { IntegrationError } from '../src/utils/errors';
import { LOG_SERIALIZERS, REDACT_PATHS } from '../src/utils/logger';
import { PROCESS_METRICS_MSG, takeRequestStats } from '../src/utils/processMetrics';
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
  'FAKE_GATEWAY_SECRET',
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

// The production alarms read log lines through metric filters (infra/terraform/modules/observability/main.tf, its
// locals). A field or a message renamed here without there would leave an alarm silently blind, never firing.
describe('the lines the production alarms read', () => {
  const tf = readFileSync(
    join(__dirname, '../../infra/terraform/modules/observability/main.tf'),
    'utf8',
  );
  const local = (name: string) => tf.match(new RegExp(`^\\s*${name}\\s*=\\s*"([^"]+)"`, 'm'))?.[1];
  const fields = (name: string) => {
    const block = tf.match(new RegExp(`${name} = \\{([^}]*)\\}`))?.[1] ?? '';
    return [...block.matchAll(/=\s*"(\w+)"/g)].map((m) => m[1]);
  };

  it('match the message the metrics timer and the runner log', () => {
    expect(local('metrics_message')).toBe(PROCESS_METRICS_MSG);
    const runner = readFileSync(join(__dirname, '../src/jobs/runner.ts'), 'utf8');
    expect(runner).toContain(`'${local('dead_letter_message')}'`);
  });

  it("read fields the API's metrics line carries", async () => {
    await api().get('/api/health');
    const line = takeRequestStats();
    expect(fields('api_line_fields')).toHaveLength(3);
    for (const field of fields('api_line_fields')) expect(line).toHaveProperty(field!);
  });

  it("read fields the worker's metrics line carries", () => {
    const line = queueFields(['q'], [{ depth: 1, oldestAgeSec: 2 }]);
    expect(fields('worker_line_fields')).toHaveLength(2);
    for (const field of fields('worker_line_fields')) expect(line).toHaveProperty(field!);
  });
});
