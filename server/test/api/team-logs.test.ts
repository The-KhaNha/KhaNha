// Local only: an invite token never reaches a log line, on a successful accept or a refused one. Loads its own copy
// of the app whose logger keeps every line (like client-errors.safe.test.ts).
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type * as LoggerModule from '../../src/utils/logger';
import { supabaseAdmin } from '../../src/utils/supabase';
import { createTestUser, deleteTestStores, type TestUser } from '../setup/helpers';

const lines: Record<string, unknown>[] = [];
let server: Server;
let storeId = '';
let brandId = '';
let joiner: TestUser;

beforeAll(async () => {
  vi.resetModules();
  vi.doMock('../../src/utils/logger', async (importOriginal) => {
    const real = await importOriginal<typeof LoggerModule>();
    const logger = pino(
      {
        level: 'debug',
        redact: { paths: real.REDACT_PATHS, censor: '[Redacted]' },
        serializers: real.LOG_SERIALIZERS,
      },
      { write: (line: string) => lines.push(JSON.parse(line) as Record<string, unknown>) },
    );
    return { ...real, logger };
  });
  const { createApp } = await import('../../src/app.js');
  server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');

  const tag = randomUUID().slice(0, 8);
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .insert({ name: 'Team logs', slug: `team-logs-${tag}`, status: 'ACTIVE' })
    .select('id')
    .single()
    .throwOnError();
  brandId = brand.id;
  const { data: store } = await supabaseAdmin
    .from('stores')
    .insert({
      name: 'Team logs',
      slug: `team-logs-${tag}`,
      brand_id: brandId,
      status: 'ACTIVE',
      tagline: 'Test',
      description: 'A store for team-logs.test.ts',
    })
    .select('id')
    .single()
    .throwOnError();
  storeId = store.id;
  joiner = await createTestUser();
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.doUnmock('../../src/utils/logger');
  await deleteTestStores([storeId], [brandId], [joiner]);
});

it.each([
  ['an accepted invite', true, 200],
  ['a refused one', false, 404],
] as const)('%s leaves no token in any log line', async (_label, valid, status) => {
  const token = randomBytes(32).toString('base64url');
  if (valid) {
    await supabaseAdmin
      .from('store_invites')
      .insert({
        store_id: storeId,
        role: 'STAFF',
        email: joiner.email,
        token_hash: createHash('sha256').update(token).digest('hex'),
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
      .throwOnError();
  }
  lines.length = 0;
  const res = await request(server)
    .post('/api/me/invites/accept')
    .set('Authorization', `Bearer ${joiner.token}`)
    .send({ token });
  expect(res.status).toBe(status);
  await vi.waitFor(() => expect(lines.some((line) => line.req)).toBe(true));
  expect(JSON.stringify(lines)).not.toContain(token);
});
