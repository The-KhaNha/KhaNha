import { describe, expect, it } from 'vitest';
import { JSON_BODY_LIMIT_BYTES } from '../../src/app';
import { api } from '../setup/api';

describe('JSON body limit', () => {
  it('a declared length over the limit -> 413 PAYLOAD_TOO_LARGE with Connection: close, before auth runs', async () => {
    const body = JSON.stringify({ note: 'x'.repeat(JSON_BODY_LIMIT_BYTES + 1) });
    const res = await api().post('/api/orders').set('Content-Type', 'application/json').send(body);
    expect(res.status).toBe(413);
    expect(res.headers.connection).toBe('close');
    expect(res.body).toEqual({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'The request body is too large.' },
    });
  });

  it('a body just under the limit reaches the route (here: 401, no token)', async () => {
    const body = JSON.stringify({ note: 'x'.repeat(JSON_BODY_LIMIT_BYTES - 100) });
    const res = await api().post('/api/orders').set('Content-Type', 'application/json').send(body);
    expect(res.status).toBe(401);
  });
});
