'use strict';
const { defineConfig, devices } = require('@playwright/test');

/*
 * Local and CI runs: Playwright starts scripts/serve.js, which serves the built dist/index.html.
 * Against a live site: set BASE_URL (CI does this after deploying) and no local server is started.
 *   BASE_URL=https://you.github.io/string-to-vscode-theme/ pnpm test:smoke
 *
 * CHROME_PATH=/path/to/chrome uses an installed Chrome/Chromium instead of the one from
 * `pnpm playwright:install` (handy on machines where that download is blocked).
 */
const remote = Boolean(process.env.BASE_URL);
// A trailing slash keeps relative URLs (like "./#name") inside a project-pages path such as /<repo>/.
const baseURL = remote ? process.env.BASE_URL.replace(/\/?$/, '/') : 'http://127.0.0.1:4173/';

module.exports = defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] } : {}
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: remote
    ? undefined
    : { command: 'node scripts/serve.js', url: 'http://127.0.0.1:4173/', reuseExistingServer: !process.env.CI, timeout: 30_000 }
});
