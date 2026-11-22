import { expect, test } from '@playwright/test';
import { mockApi } from './fixtures';

// Production's three hosts (P8 PR 05b, lib/hosts.ts), played by localhost aliases whose requests the page answers
// from the one dev server on 127.0.0.1, where Vite listens (no browser resolves them the same way). The settings arrive the way the web image sends
// them, in /runtime-env.js.
test.beforeEach(async ({ page, baseURL }) => {
  const port = new URL(baseURL ?? '').port;
  const hosts = {
    CUSTOMER_HOST: `localhost:${port}`,
    STAFF_HOST: `staff.localhost:${port}`,
    ADMIN_HOST: `admin.localhost:${port}`,
  };
  await mockApi(page);
  await page.route(/^http:\/\/(staff|admin)\.localhost:\d+\/(?!api\/)/, async (route) => {
    const url = route
      .request()
      .url()
      .replace(/\/\/(staff|admin)\.localhost/, '//127.0.0.1');
    await route.fulfill({ response: await route.fetch({ url }) });
  });
  await page.route('**/runtime-env.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `window.__RUNTIME_ENV__=${JSON.stringify(hosts)};`,
    }),
  );
});

test('each section lives on its own host, and old links land there', async ({ page, baseURL }) => {
  const port = new URL(baseURL ?? '').port;
  await page.goto('/admin');
  // Signed out on that host (each keeps its own sign-in), so the page may move on to its sign-in.
  const onHost = (host: string, path: string) =>
    new RegExp(
      `^http://${host.replaceAll('.', '\\.')}:${port}(${path}|/login\\?next=${encodeURIComponent(path)})$`,
    );
  await expect(page).toHaveURL(onHost('admin.localhost', '/admin'));

  await page.goto(`http://staff.localhost:${port}/`);
  await expect(page).toHaveURL(onHost('staff.localhost', '/staff'));

  await page.goto(`http://staff.localhost:${port}/s/campus-cafe`);
  await expect(page).toHaveURL(`http://localhost:${port}/s/campus-cafe`);
});
