import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { REDACT_PATHS } from '../src/utils/logger';
import { api } from './setup/api';

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      done();
    },
  });
  return { lines, log: pino({ redact: { paths: REDACT_PATHS, censor: '[Redacted]' } }, stream) };
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
