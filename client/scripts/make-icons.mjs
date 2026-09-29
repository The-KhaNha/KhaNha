#!/usr/bin/env node
// Renders the app icons from public/icon.svg with the Chromium Playwright already installs (npm run e2e:install
// installs WebKit; `npx playwright install chromium` for this). Run after changing the icon:
//   node scripts/make-icons.mjs
// A full-bleed square (no rounded corners) for the maskable and Apple icons: Android crops maskable icons to its own
// shape, and iOS paints transparent corners black. The bag sits inside the 80% safe zone either way.
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const rounded = readFileSync(new URL('../public/icon.svg', import.meta.url), 'utf8');
const square = rounded.replace(' rx="16"', '');
const OUT = [
  { file: 'icon-192.png', size: 192, svg: rounded },
  { file: 'icon-512.png', size: 512, svg: rounded },
  { file: 'icon-maskable-512.png', size: 512, svg: square },
  { file: 'apple-touch-icon.png', size: 180, svg: square },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const { file, size, svg } of OUT) {
  await page.setViewportSize({ width: size, height: size });
  const sized = svg.replace('<svg ', `<svg width="${size}" height="${size}" `);
  await page.setContent(`<body style="margin:0;background:transparent">${sized}</body>`);
  await page.screenshot({
    path: new URL(`../public/${file}`, import.meta.url).pathname,
    omitBackground: true,
    clip: { x: 0, y: 0, width: size, height: size },
  });
  console.log(`public/${file} ${size}×${size}`);
}
await browser.close();
