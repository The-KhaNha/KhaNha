/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Read from disk (Vitest runs in the client package): under this config a `?raw` CSS import comes back empty.
const css = readFileSync(`${process.cwd()}/src/index.css`, 'utf8');

/**
 * Every text and fill pairing the components use meets WCAG AA in both colour schemes: 4.5:1 for text, 3:1 for the
 * focus ring and meaningful icons. Values are read from index.css (the @theme block, then its dark override), so a
 * colour tweak in either scheme cannot quietly break contrast. A new pairing in a component goes in this list.
 */
const TEXT: [string, string][] = [
  ['ink', 'bg'],
  ['ink', 'surface'],
  ['ink', 'surface-2'],
  ['muted', 'bg'],
  ['muted', 'surface'],
  ['muted', 'surface-2'],
  ['brand-600', 'surface'],
  ['brand-600', 'bg'],
  ['brand-700', 'brand-50'],
  ['brand-700', 'surface'],
  ['gold-700', 'gold-50'],
  ['gold-700', 'surface'],
  ['success-700', 'success-50'],
  ['success-700', 'surface'],
  ['cancel-700', 'cancel-50'],
  ['collected-700', 'surface-2'],
  ['white', 'brand-500'],
  ['white', 'brand-deep'],
  ['white', 'ink-fill'],
  ['white', 'success-500'],
  ['on-gold', 'gold-500'],
];
const NON_TEXT: [string, string][] = [
  ['focus', 'bg'],
  ['focus', 'surface'],
  ['hint', 'surface'],
  ['success-500', 'surface'],
];

function tokens(block: string): Record<string, string> {
  return Object.fromEntries(
    [...block.matchAll(/--color-([\w-]+):\s*(#[0-9a-fA-F]{6}|var\(--color-([\w-]+)\))/g)].map(
      (m) => [m[1], m[3] ? `@${m[3]}` : m[2]],
    ),
  );
}

const theme = css.slice(css.indexOf('@theme'), css.indexOf('@keyframes'));
const darkStart = css.indexOf('@media (prefers-color-scheme: dark)');
const dark = css.slice(darkStart, css.indexOf('@layer base', darkStart));
const LIGHT = { white: '#ffffff', ...tokens(theme) };
const SCHEMES = { light: LIGHT, dark: { ...LIGHT, ...tokens(dark) } };

function hex(palette: Record<string, string>, name: string): string {
  const value = palette[name];
  if (!value) throw new Error(`no --color-${name}`);
  return value.startsWith('@') ? hex(palette, value.slice(1)) : value;
}

function luminance(color: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(color.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

describe.each(Object.entries(SCHEMES))('%s scheme', (_scheme, palette) => {
  it('dark mode overrides exist', () => {
    expect(Object.keys(tokens(dark)).length).toBeGreaterThan(10);
  });
  it.each(TEXT)('%s on %s is at least 4.5:1', (fg, bg) => {
    expect(contrast(hex(palette, fg), hex(palette, bg))).toBeGreaterThanOrEqual(4.5);
  });
  it.each(NON_TEXT)('%s on %s is at least 3:1', (fg, bg) => {
    expect(contrast(hex(palette, fg), hex(palette, bg))).toBeGreaterThanOrEqual(3);
  });
});
