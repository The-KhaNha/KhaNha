import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// client/perf-budget.json is the one place the web-vital budgets are set (CLAUDE.md §2b): the smoke reads it, and
// Lighthouse CI's assertions must say the same, or a loosened or tightened budget applies in one check and not another.
const budget = JSON.parse(readFileSync('client/perf-budget.json', 'utf8'));
const lighthouse = JSON.parse(readFileSync('client/lighthouserc.json', 'utf8')).ci.assert
  .assertions;
const max = (audit) => lighthouse[audit]?.[1]?.maxNumericValue;

test('Lighthouse CI asserts the budgets in perf-budget.json', () => {
  assert.equal(max('largest-contentful-paint'), budget.lcpMs);
  assert.equal(max('cumulative-layout-shift'), budget.cls);
  // Lighthouse's lab stand-in for INP: the main thread blocked while the page loads.
  assert.equal(max('total-blocking-time'), budget.inpMs);
});
