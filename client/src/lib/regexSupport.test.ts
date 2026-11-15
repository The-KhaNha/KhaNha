import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Vite's default build target is Safari 14, and a regex feature the target lacks is not transpiled: esbuild only turns
// the literal into `new RegExp(…)`, which then throws on the phone. Lookbehind arrived in Safari 16.4, so on an older
// iPhone the error reporter's scrub threw inside its try/catch and every crash report was dropped without a trace.
const SRC = join(process.cwd(), 'src');
const LOOKBEHIND = /\(\?<[=!]/;

const sources = readdirSync(SRC, { recursive: true, encoding: 'utf8' }).filter(
  (path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path),
);

describe('client source regexes run on the build target', () => {
  it('finds the source files', () => {
    expect(sources.length).toBeGreaterThan(20);
  });

  it.each(sources)('%s uses no lookbehind', (path) => {
    expect(readFileSync(join(SRC, path), 'utf8')).not.toMatch(LOOKBEHIND);
  });
});
