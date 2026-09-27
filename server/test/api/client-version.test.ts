// Destructive: raises site_settings.min_client_version; resetDemoData() puts it back (local only).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invalidate } from '../../src/utils/cache';
import { supabaseAdmin } from '../../src/utils/supabase';
import { resetDemoData } from '../setup/helpers';
import { api } from '../setup/api';

beforeAll(async () => {
  resetDemoData();
  await supabaseAdmin
    .from('site_settings')
    .update({ min_client_version: '9.0.0' })
    .eq('id', true)
    .throwOnError();
  invalidate('site_settings');
});

afterAll(() => resetDemoData());

describe('client version gate', () => {
  it('426 CLIENT_OUTDATED for an older client', async () => {
    const res = await api().get('/api/menu').set('X-Client-Version', '0.1.0');
    expect(res.status).toBe(426);
    expect(res.body).toEqual({
      error: { code: 'CLIENT_OUTDATED', message: expect.stringContaining('Refresh the page') },
    });
  });

  it('treats a missing or malformed header as the legacy 0.1.0 client', async () => {
    expect((await api().get('/api/menu')).status).toBe(426);
    expect((await api().get('/api/menu').set('X-Client-Version', 'nope')).status).toBe(426);
  });

  it('serves a client at or above the minimum, prerelease included', async () => {
    expect((await api().get('/api/menu').set('X-Client-Version', '9.0.0')).status).toBe(200);
    expect((await api().get('/api/menu').set('X-Client-Version', '9.0.0-dev.1')).status).toBe(200);
  });

  it('never gates the probes', async () => {
    expect((await api().get('/api/health')).status).toBe(200);
    expect((await api().get('/api/ready')).status).toBe(200);
  });

  it('gates before authentication, so an old tab gets 426 rather than 401', async () => {
    const res = await api().get('/api/orders').set('X-Client-Version', '0.1.0');
    expect(res.status).toBe(426);
  });
});
