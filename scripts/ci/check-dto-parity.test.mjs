import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, test } from 'node:test';
import { compareDtos, loadTypescript } from './check-dto-parity.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
// The compiler comes from client/node_modules. The repo job installs only the root, so it skips this file; the client
// job, where the client's dependencies are installed, runs it (and the check itself) in CI.
const skip = existsSync(join(root, 'client/node_modules/typescript'))
  ? false
  : 'client dependencies not installed; the CI client job runs this';

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dto-parity-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const diff = (server, client, allow, optional = []) => {
  writeFileSync(join(dir, 'server.ts'), server);
  writeFileSync(join(dir, 'client.ts'), client);
  return compareDtos(
    loadTypescript(root),
    join(dir, 'server.ts'),
    join(dir, 'client.ts'),
    allow,
    optional,
  );
};

test('equal shapes pass, however the types are spelled', { skip }, () => {
  const server = `type R = 'A' | 'B';
    export interface OrderDto { id: string; role: R; lines: { n: number; note: string | null }[]; by: Record<string, number> }`;
  const client = `export interface Order { id: string; role: 'B' | 'A'; lines: { n: number; note: null | string }[]; by: Record<string, number> }`;
  assert.deepEqual(diff(server, client, new Set()), []);
});

test('a field on one side only fails, nested ones too', { skip }, () => {
  const server = `export interface XDto { a: string; inner: { b: number; c: number } }`;
  const client = `export interface X { a: string; extra: string; inner: { b: number } }`;
  const found = diff(server, client, new Set());
  assert.ok(found.some((p) => p.includes('XDto.inner.c?') && p.includes('only on the server')));
  assert.ok(found.some((p) => p.includes('XDto.extra?') && p.includes('only on the client')));
});

test('optional on one side and required on the other fails', { skip }, () => {
  const found = diff(
    `export interface XDto { a: string; b?: string }`,
    `export interface X { a?: string; b: string }`,
    new Set(),
  );
  assert.equal(found.length, 2);
});

test(
  'a client-optional field the server always sends is allowed only when listed; the reverse never is',
  { skip },
  () => {
    const server = `export interface XDto { a: string; b?: string }`;
    const client = `export interface X { a?: string; b: string }`;
    assert.equal(diff(server, client, new Set()).length, 2);
    // a is listed: only b (client required, server optional) is left.
    const found = diff(server, client, new Set(), [/^XDto\.a\?$/]);
    assert.equal(found.length, 1);
    assert.ok(found.some((p) => p.startsWith('XDto.b?')));
  },
);

test('a changed literal or nullability fails', { skip }, () => {
  const found = diff(
    `export interface XDto { s: 'A' | 'B'; n: string | null }`,
    `export interface X { s: 'A' | 'C'; n: string }`,
    new Set(),
  );
  assert.equal(found.length, 2);
});

test(
  'a server type with no client copy fails unless listed, and a listed one with a copy fails',
  { skip },
  () => {
    const server = `export interface LonelyDto { a: string }`;
    assert.match(diff(server, `export {}`, new Set())[0], /no client type "Lonely"/);
    assert.deepEqual(diff(server, `export {}`, new Set(['LonelyDto'])), []);
    assert.match(
      diff(server, `export interface Lonely { a: string }`, new Set(['LonelyDto']))[0],
      /listed in NO_CLIENT_COPY/,
    );
  },
);

test('the real server and client response types match', { skip }, () => {
  assert.deepEqual(
    compareDtos(
      loadTypescript(root),
      join(root, 'server/src/types/api.ts'),
      join(root, 'client/src/types/api.ts'),
    ),
    [],
  );
});
