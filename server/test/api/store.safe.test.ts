import { describe, expect, it } from 'vitest';
import { api } from '../setup/api';

describe('GET /api/store', () => {
  it('needs no Authorization header, and returns the store DTO with exactly its documented keys', async () => {
    const res = await api().get('/api/store');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.store).sort()).toEqual(
      [
        'id',
        'name',
        'tagline',
        'description',
        'imageUrl',
        'isOpen',
        'prepTimeMinMinutes',
        'prepTimeMaxMinutes',
      ].sort(),
    );
  });

  it('never leaks stack traces or SQL in the body', async () => {
    const res = await api().get('/api/store');
    expect(JSON.stringify(res.body)).not.toMatch(
      /\bat .*\.(ts|js)|stack|PGRST|SQLSTATE|select |insert |update /i,
    );
  });
});
