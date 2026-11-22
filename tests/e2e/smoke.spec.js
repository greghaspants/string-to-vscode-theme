'use strict';
/*
 * Post-deploy smoke test. CI runs it against the live GitHub Pages URL right after deploying:
 *   BASE_URL=https://<user>.github.io/<repo>/ EXPECT_BUILD=<commit sha> pnpm test:smoke
 * It also runs in the normal local suite against the built page.
 *
 * What it proves about the deployed site, not just the source:
 *   1. it is the build we just shipped (EXPECT_BUILD matches <meta name="build">)
 *   2. it loads with no errors and no foreign requests
 *   3. it gives the same colors as the engine in src/ (so "same name, same colors" holds in production)
 */
const { test, expect } = require('@playwright/test');
const E = require('../../src/engine.js');

test('the live page is the build that was just deployed', async ({ page }) => {
  test.skip(!process.env.EXPECT_BUILD, 'EXPECT_BUILD is only set by the deploy workflow');
  // GitHub Pages can serve the previous version for a short while after a deploy, so poll.
  const waitMs = Number(process.env.SMOKE_WAIT_MS || 120_000);
  test.setTimeout(waitMs + 30_000);
  await expect
    .poll(
      async () => {
        await page.goto('./?nocache=' + Date.now());
        return page.locator('meta[name="build"]').getAttribute('content');
      },
      { timeout: waitMs, intervals: [2_000, 5_000, 10_000], message: 'the live site is not serving the new build yet' }
    )
    .toBe(process.env.EXPECT_BUILD);
});

test('loads cleanly and produces the same colors as the source engine', async ({ page, baseURL, context }) => {
  const problems = [];
  const foreign = [];
  const origin = new URL(baseURL).origin;
  page.on('pageerror', (e) => problems.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('request', (r) => { if (!r.url().startsWith(origin) && !/^(data|blob):/.test(r.url())) foreign.push(r.url()); });

  await page.goto('./#tidepool--editor--panel--braces');
  await expect(page.locator('h1')).toHaveText('String-to-VS-Code*-theme util');
  await expect(page.locator('#seed')).toHaveValue('tidepool');

  const live = JSON.parse(await page.locator('#snippet').textContent());
  const want = JSON.parse(E.makeSnippet(E.buildTheme('tidepool', 'auto'), { adapt: true, explorer: true, editor: true, panel: true, braces: true }));
  expect(live).toEqual(want);

  // "Copy link to this page" copies the real deployed address with the options in the hash: the one thing only
  // this test can prove about the live site.
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.locator('#copyLink').click();
  await expect(page.locator('#copied')).toContainText('Link copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(new URL('./#tidepool--editor--panel--braces', baseURL).href);

  expect(problems).toEqual([]);
  expect(foreign).toEqual([]);
});
