// Destructive: resetDemoData() first, so site_settings holds the seeded defaults the fallbacks must match.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { invalidate } from '../../src/utils/cache';
import type { Database } from '../../src/types/database';
import { logger } from '../../src/utils/logger';
import { supabaseAdmin } from '../../src/utils/supabase';
import { createTestUser, deleteTestUser, resetDemoData, type TestUser } from '../setup/helpers';
import { api } from '../setup/api';

const fallbacks = JSON.parse(
  readFileSync(join(__dirname, '../../../client/src/config/fallbacks.json'), 'utf8'),
) as Record<string, unknown>;

beforeAll(() => resetDemoData());
afterAll(() => resetDemoData());

describe('GET /api/config', () => {
  it('equals the client fallbacks (minus serverVersion and the validation bounds)', async () => {
    const res = await api().get('/api/config');
    expect(res.status).toBe(200);
    const { serverVersion, ...config } = res.body as Record<string, unknown>;
    const { validation: _validation, ...defaults } = fallbacks;
    expect(serverVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(config).toEqual(defaults);
  });

  it('needs no token and is never gated by the client version', async () => {
    await supabaseAdmin
      .from('site_settings')
      .update({ min_client_version: '9.0.0' })
      .eq('id', true)
      .throwOnError();
    invalidate('site_settings');
    const res = await api().get('/api/config').set('X-Client-Version', '0.1.0');
    expect(res.status).toBe(200);
    expect(res.body.minClientVersion).toBe('9.0.0');
  });

  it('follows an admin change at once through the settings cache', async () => {
    await supabaseAdmin
      .from('site_settings')
      .update({ order_poll_ms: 6000, min_client_version: '0.0.0' })
      .eq('id', true)
      .throwOnError();
    invalidate('site_settings');
    const res = await api().get('/api/config');
    expect(res.body.polling.orderMs).toBe(6000);
  });

  it('is revalidated, never given a max-age', async () => {
    const res = await api().get('/api/config');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers.etag).toBeDefined();
  });
});

describe('GET /api/config features', () => {
  const key = () => `test_${randomUUID().replaceAll('-', '')}`;
  const [visible, targeted, serverOnly] = [key(), key(), key()];
  let admin: TestUser;

  beforeAll(async () => {
    admin = await createTestUser('ADMIN');
    await supabaseAdmin
      .from('feature_flags')
      // A multi-row insert sends null for a column one row leaves out, so every row names the same columns.
      .insert(
        [
          { key: visible, client_visible: true, rules: {} },
          { key: targeted, client_visible: true, rules: { roles: ['CUSTOMER'] } },
          { key: serverOnly, client_visible: false, rules: {} },
        ].map((flag) => ({ ...flag, description: 'config.test.ts', enabled: true })),
      )
      .throwOnError();
    invalidate('feature_flags');
  }, 30_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await supabaseAdmin
      .from('feature_flags')
      .delete()
      .in('key', [visible, targeted, serverOnly])
      .throwOnError();
    invalidate('feature_flags');
    await deleteTestUser(admin);
  });

  it('holds a client-visible flag as its enabled; a targeted one is false; a server-only one is absent', async () => {
    const res = await api().get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body.features[visible]).toBe(true);
    expect(res.body.features[targeted]).toBe(false);
    expect(res.body.features).not.toHaveProperty(serverOnly);
  });

  it('shows an admin flip on the next request', async () => {
    await api().get('/api/config'); // the flags are in the read cache
    const flip = await api()
      .patch(`/api/admin/flags/${visible}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ enabled: false });
    try {
      expect(flip.status).toBe(200);
      const res = await api().get('/api/config');
      expect(res.body.features[visible]).toBe(false);
    } finally {
      // Undone, so every test here stands alone whatever the order.
      await supabaseAdmin
        .from('feature_flags')
        .update({ enabled: true })
        .eq('key', visible)
        .throwOnError();
      invalidate('feature_flags');
    }
  });

  it('lists client-visible flags in key order, so the same flags always give the same body and ETag', async () => {
    // Inserted in reverse order: without an order on the read, the table's own order would show through.
    const suffix = randomUUID().replaceAll('-', '');
    const keys = [`zz_order_${suffix}`, `mm_order_${suffix}`, `aa_order_${suffix}`];
    for (const k of keys) {
      await supabaseAdmin
        .from('feature_flags')
        .insert({
          key: k,
          client_visible: true,
          enabled: true,
          rules: {},
          description: 'config.test.ts',
        })
        .throwOnError();
    }
    invalidate('feature_flags');
    try {
      const first = await api().get('/api/config');
      const listed = Object.keys(first.body.features).filter((k) => keys.includes(k));
      expect(listed).toEqual([...keys].sort());
      const again = await api().get('/api/config');
      expect(again.headers.etag).toBe(first.headers.etag);
    } finally {
      await supabaseAdmin.from('feature_flags').delete().in('key', keys).throwOnError();
      invalidate('feature_flags');
    }
  });

  it('shows a client-visible flag with malformed rules as false, and the response keeps the fallbacks shape', async () => {
    const bad = key();
    await supabaseAdmin
      .from('feature_flags')
      .insert({
        key: bad,
        client_visible: true,
        enabled: true,
        rules: { roles: [] },
        description: 'config.test.ts',
      })
      .throwOnError();
    invalidate('feature_flags');
    try {
      const res = await api().get('/api/config');
      expect(res.body.features[bad]).toBe(false);
      expect(Object.keys(res.body).sort()).toEqual(
        [...Object.keys(fallbacks).filter((k) => k !== 'validation'), 'serverVersion'].sort(),
      );
    } finally {
      await supabaseAdmin.from('feature_flags').delete().eq('key', bad).throwOnError();
      invalidate('feature_flags');
    }
  });

  it('fails closed when the flags cannot be read: no features, still 200, one warn per outage', async () => {
    const from = supabaseAdmin.from.bind(supabaseAdmin);
    vi.spyOn(supabaseAdmin, 'from').mockImplementation(((
      table: keyof Database['public']['Tables'],
    ) => {
      if (table === 'feature_flags') throw new Error('flags read failed');
      return from(table);
    }) as typeof supabaseAdmin.from);
    const warn = vi.spyOn(logger, 'warn');
    invalidate('feature_flags');
    try {
      for (let i = 0; i < 2; i += 1) {
        const res = await api().get('/api/config');
        expect(res.status).toBe(200);
        expect(res.body.features).toEqual({});
      }
      const lines = warn.mock.calls.filter(
        ([, msg]) => msg === 'Feature flags unreadable, no features',
      );
      expect(lines).toHaveLength(1);
    } finally {
      // The outage ends here: the mocks go, and one good read clears the once-per-outage flag for whatever runs next.
      vi.restoreAllMocks();
      invalidate('feature_flags');
      await api().get('/api/config');
    }
  });
});
