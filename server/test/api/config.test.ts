// Destructive: resetDemoData() first, so site_settings holds the seeded defaults the fallbacks must match.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invalidate } from '../../src/utils/cache';
import { supabaseAdmin } from '../../src/utils/supabase';
import { resetDemoData } from '../setup/helpers';
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
