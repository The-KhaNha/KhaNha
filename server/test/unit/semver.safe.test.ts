import { describe, expect, it } from 'vitest';
import { compareSemver, parseSemver } from '../../src/utils/semver';

describe('parseSemver', () => {
  it('reads the numeric triple, with or without a prerelease label', () => {
    expect(parseSemver('1.2.3')).toEqual([1, 2, 3]);
    expect(parseSemver('0.4.0-dev.3')).toEqual([0, 4, 0]);
  });

  it('rejects anything else', () => {
    for (const bad of ['', '1.2', '1.2.3.4', 'v1.2.3', '1.2.x'])
      expect(parseSemver(bad)).toBeUndefined();
  });
});

describe('compareSemver', () => {
  it('orders by major, then minor, then patch, numerically', () => {
    expect(compareSemver('0.1.0', '0.2.0')).toBeLessThan(0);
    expect(compareSemver('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareSemver('1.0.0', '0.99.99')).toBeGreaterThan(0);
    expect(compareSemver('2.3.4', '2.3.4')).toBe(0);
  });

  it('ignores prerelease labels, so staging is never older than its own release', () => {
    expect(compareSemver('0.4.0-dev.3', '0.4.0')).toBe(0);
  });

  it('sorts an unparseable version first', () => {
    expect(compareSemver('junk', '0.0.0')).toBeLessThan(0);
    expect(compareSemver('0.0.0', 'junk')).toBeGreaterThan(0);
  });
});
