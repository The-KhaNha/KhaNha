import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LIMITS } from '../../src/schemas/limits';

// Read, not imported: the client's JSON is outside the server's rootDir, and an import would fail typecheck.
const fallbacks = JSON.parse(
  readFileSync(join(__dirname, '../../../client/src/config/fallbacks.json'), 'utf8'),
) as { validation: unknown };

describe('field bounds parity', () => {
  it('client/src/config/fallbacks.json validation equals server/src/schemas/limits.ts', () => {
    expect(fallbacks.validation).toEqual(LIMITS);
  });
});
