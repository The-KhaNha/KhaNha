// Local only: onboarding a restaurant (P7.4a) writes its log lines without the owner invite's token or the invitee's
// email. Loads its own copy of the app whose logger keeps every line (like team-logs.test.ts).
import { randomUUID } from 'node:crypto';
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
let admin: TestUser;
let brandId = '';

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
  admin = await createTestUser('ADMIN');
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.doUnmock('../../src/utils/logger');
  if (!brandId) return deleteTestStores([], [], [admin]);
  const { data: invites } = await supabaseAdmin
    .from('brand_invites')
    .select('id')
    .eq('brand_id', brandId)
    .throwOnError();
  await supabaseAdmin
    .from('domain_events')
    .delete()
    .in('aggregate_id', [brandId, ...invites.map((i) => i.id)])
    .throwOnError();
  const { data: stores } = await supabaseAdmin
    .from('stores')
    .select('id')
    .eq('brand_id', brandId)
    .throwOnError();
  await deleteTestStores(
    stores.map((s) => s.id),
    [brandId],
    [admin],
  );
});

it('create, invite and revoke (twice) leave no token and no invitee email in any log line', async () => {
  const auth = { Authorization: `Bearer ${admin.token}` };
  const email = `logged-${randomUUID().slice(0, 8)}@example.test`;
  lines.length = 0;
  const created = await request(server)
    .post('/api/admin/brands')
    .set(auth)
    .send({ name: `Logs ${randomUUID().slice(0, 8)}` });
  expect(created.status).toBe(201);
  brandId = created.body.brand.id;
  const sent = await request(server)
    .post(`/api/admin/brands/${brandId}/invites`)
    .set(auth)
    .send({ email });
  expect(sent.status).toBe(201);
  const revoked = await request(server)
    .delete(`/api/admin/brands/${brandId}/invites/${sent.body.invite.id}`)
    .set(auth);
  expect(revoked.status).toBe(204);
  const again = await request(server)
    .delete(`/api/admin/brands/${brandId}/invites/${sent.body.invite.id}`)
    .set(auth);
  expect(again.status).toBe(204);
  // And an accept (PR 02): a refused one, with a real-looking token, logs neither the token nor the email.
  const guess = 'y'.repeat(43);
  const refused = await request(server)
    .post('/api/me/brand-invites/accept')
    .set(auth)
    .send({ token: guess });
  expect(refused.status).toBe(404);

  await vi.waitFor(() =>
    expect(lines.filter((line) => typeof line.msg === 'string').map((l) => l.msg)).toEqual(
      expect.arrayContaining(['Brand created', 'Owner invite created', 'Owner invite revoked']),
    ),
  );
  // The repeat revoke changed nothing, so it wrote no second line.
  expect(lines.filter((l) => l.msg === 'Owner invite revoked')).toHaveLength(1);
  const all = JSON.stringify(lines);
  expect(all).not.toContain(sent.body.token);
  expect(all).not.toContain(guess);
  expect(all).not.toContain(email);
});
