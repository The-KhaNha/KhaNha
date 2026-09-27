import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gzipKb, initialChunks, lazyChunks } from './check-bundle.mjs';

const manifest = {
  'index.html': { file: 'assets/index.js', isEntry: true, imports: ['_vendor.js'] },
  '_vendor.js': { file: 'assets/vendor.js', imports: ['_shared.js'] },
  '_shared.js': { file: 'assets/shared.js' },
  'src/pages/Checkout.tsx': {
    file: 'assets/Checkout.js',
    isDynamicEntry: true,
    imports: ['_shared.js'],
  },
  'style.css': { file: 'assets/index.css' },
};

test('initial chunks follow static imports from the entry, once each', () => {
  assert.deepEqual(initialChunks(manifest).sort(), ['_shared.js', '_vendor.js', 'index.html']);
});

test('lazy chunks are the JS chunks outside the initial graph', () => {
  assert.deepEqual(lazyChunks(manifest, initialChunks(manifest)), ['src/pages/Checkout.tsx']);
});

test('a manifest without an entry is an error', () => {
  assert.throws(() => initialChunks({ a: { file: 'a.js' } }), /No entry chunk/);
});

test('gzipKb compresses', () => {
  assert.ok(gzipKb(Buffer.from('a'.repeat(10_000))) < 1);
});
