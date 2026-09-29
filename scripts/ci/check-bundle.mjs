#!/usr/bin/env node
// Fails when the initial JS (the entry chunk plus everything it imports statically) is over the gzip budget in
// client/perf-budget.json. Lazy chunks are listed for information only: they load after first paint.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

export function initialChunks(manifest) {
  const entry = Object.keys(manifest).find((key) => manifest[key].isEntry);
  if (!entry) throw new Error('No entry chunk in the Vite manifest');
  const seen = new Set();
  const visit = (key) => {
    if (seen.has(key)) return;
    seen.add(key);
    for (const dep of manifest[key].imports ?? []) visit(dep);
  };
  visit(entry);
  return [...seen];
}

export function lazyChunks(manifest, initial) {
  const initialSet = new Set(initial);
  return Object.keys(manifest).filter(
    (key) => !initialSet.has(key) && manifest[key].file.endsWith('.js'),
  );
}

export function gzipKb(buffer) {
  return gzipSync(buffer, { level: 9 }).length / 1024;
}

function main() {
  const clientDir = resolve(process.argv[2] ?? 'client');
  const distDir = join(clientDir, 'dist');
  const manifest = JSON.parse(readFileSync(join(distDir, '.vite', 'manifest.json'), 'utf8'));
  const { initialJsGzipKb } = JSON.parse(readFileSync(join(clientDir, 'perf-budget.json'), 'utf8'));

  const size = (key) => gzipKb(readFileSync(join(distDir, manifest[key].file)));
  const initial = initialChunks(manifest).map((key) => ({
    file: manifest[key].file,
    kb: size(key),
  }));
  const lazy = lazyChunks(manifest, initialChunks(manifest)).map((key) => ({
    file: manifest[key].file,
    kb: size(key),
  }));
  const total = initial.reduce((sum, chunk) => sum + chunk.kb, 0);

  console.log('Initial JS (gzip -9):');
  console.table(initial.map(({ file, kb }) => ({ file, 'KB gzip': kb.toFixed(1) })));
  console.log('Lazy chunks (information only):');
  console.table(lazy.map(({ file, kb }) => ({ file, 'KB gzip': kb.toFixed(1) })));
  console.log(`Initial total ${total.toFixed(1)} KB, budget ${initialJsGzipKb} KB`);

  if (total > initialJsGzipKb) {
    console.error(`Over budget by ${(total - initialJsGzipKb).toFixed(1)} KB`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
