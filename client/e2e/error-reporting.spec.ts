import { expect, test } from '@playwright/test';
import fallbacks from '../src/config/fallbacks.json' with { type: 'json' };

test('a failed page chunk shows the connection fallback without sending a crash report', async ({
  page,
}) => {
  const sends: string[] = [];
  await page.route('**/api/config', (route) =>
    route.fulfill({ json: { ...fallbacks, serverVersion: '0.0.0' } }),
  );
  await page.route('**/src/pages/Login.tsx*', (route) => route.abort());
  await page.route('**/api/client-errors', (route) => {
    sends.push(route.request().url());
    return route.fulfill({ status: 204 });
  });
  await page.goto('/login');
  await expect(page.getByText("This page didn't load")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try Again' })).toBeVisible();
  await page.waitForTimeout(400);
  expect(sends).toEqual([]);
});

test('a delayed zero-percent config keeps startup errors off the network', async ({ page }) => {
  let releaseConfig = () => {};
  const held = new Promise<void>((resolve) => {
    releaseConfig = resolve;
  });
  const sends: string[] = [];
  await page.route('**/api/config', async (route) => {
    await held;
    await route.fulfill({
      json: { ...fallbacks, serverVersion: '0.0.0', clientErrors: { samplePercent: 0 } },
    });
  });
  await page.route('**/api/client-errors', (route) => {
    sends.push(route.request().url());
    return route.fulfill({ status: 204 });
  });
  try {
    await page.goto('/nowhere');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await page.evaluate(() =>
      window.dispatchEvent(new ErrorEvent('error', { message: 'startup bug' })),
    );
    // Past the reporter's debounce: a fallback 100% sample would already have sent this.
    await page.waitForTimeout(400);
    expect(sends).toEqual([]);
    releaseConfig();
    await page.waitForTimeout(400);
    expect(sends).toEqual([]);
  } finally {
    releaseConfig();
  }
});

test('browser errors are scrubbed, batched and capped without loading auth', async ({ page }) => {
  const reports: { message: string; route: string; kind: string }[] = [];
  const authChunks: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('supabaseClient')) authChunks.push(request.url());
  });
  await page.route('**/api/config', (route) =>
    route.fulfill({ json: { serverVersion: '0.0.0', ...fallbacks } }),
  );
  await page.route('**/api/client-errors', (route) => {
    expect(route.request().headers()).not.toHaveProperty('authorization');
    expect(route.request().headers()['x-client-version']).toMatch(/^\d+\.\d+\.\d+/);
    reports.push(...route.request().postDataJSON().reports);
    return route.fulfill({ status: 204 });
  });
  await page.goto('/nowhere?token=private#hidden');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await page.evaluate(() => {
    for (let i = 0; i < 8; i++) {
      window.dispatchEvent(
        new ErrorEvent('error', {
          error: new Error(`bug ${i}: Bearer test-secret https://example.test/?private=hidden`),
        }),
      );
    }
    window.dispatchEvent(new Event('pagehide'));
  });
  await expect.poll(() => reports.length).toBe(5);
  expect(JSON.stringify(reports)).not.toContain('test-secret');
  expect(JSON.stringify(reports)).not.toContain('private=');
  expect(reports.every((report) => report.route === '/nowhere' && report.kind === 'error')).toBe(
    true,
  );
  expect(authChunks).toEqual([]);
});
