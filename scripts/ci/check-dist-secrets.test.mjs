import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { findSecrets, jwtRole, scanDir } from './check-dist-secrets.mjs';

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const jwt = (payload) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.${'x'.repeat(43)}`;

test('a publishable key and an anon JWT pass', () => {
  const text = `const k="sb_publishable_abcdefghijklmnop"; const t="${jwt({ role: 'anon', iss: 'supabase' })}";`;
  assert.deepEqual(findSecrets(text), []);
});

test('a secret key, a service_role JWT and a private key are found and redacted', () => {
  const text = [
    'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz',
    jwt({ role: 'service_role' }),
    '-----BEGIN RSA PRIVATE KEY-----',
  ].join('\n');
  const names = findSecrets(text).map((f) => f.name);
  assert.deepEqual(names, ['Supabase secret key', 'private key block', 'service_role JWT']);
  for (const { sample } of findSecrets(text)) assert.ok(!sample.includes('Uodkm0Hg'), sample);
});

test('jwtRole decodes the role claim and tolerates non-JWT text', () => {
  assert.equal(jwtRole(jwt({ role: 'authenticated' })), 'authenticated');
  assert.equal(jwtRole('eyJnot.a.jwt'), undefined);
});

test('scanDir walks the bundle, names the file and skips binaries', () => {
  const dist = mkdtempSync(join(tmpdir(), 'dist-'));
  mkdirSync(join(dist, 'assets'));
  writeFileSync(join(dist, 'assets', 'index-abc.js'), 'clean');
  writeFileSync(join(dist, 'assets', 'vendor-def.js'), 'SUPABASE_SECRET_KEY=1');
  writeFileSync(join(dist, 'photo.jpg'), 'sb_secret_binary_is_not_scanned_1234');
  assert.deepEqual(
    scanDir(dist).map(({ file, name }) => ({ file, name })),
    [{ file: 'assets/vendor-def.js', name: 'server-only env name' }],
  );
});
