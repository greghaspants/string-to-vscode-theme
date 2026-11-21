'use strict';
const { test, expect } = require('@playwright/test');

const box = (page, sel) => page.locator(sel).boundingBox();
const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test.describe('wide screens: options on the left, preview pinned on the right', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('layout', async ({ page }) => {
    await page.goto('/');
    const [controls, snippet, preview, seed, shuffle] = await Promise.all(['.controls', '.snippetpanel', '.previewpanel', '#seed', '#shuffle'].map((s) => box(page, s)));
    expect(preview.x).toBeGreaterThan(controls.x + controls.width);
    expect(preview.x).toBeGreaterThan(snippet.x + snippet.width);
    expect(snippet.y).toBeGreaterThan(controls.y + controls.height - 2); // settings.json sits under the options
    expect(Math.abs(snippet.x - controls.x)).toBeLessThan(2);
    expect(Math.abs(shuffle.y - seed.y)).toBeLessThan(3); // random-word button is on the input's row
  });

  test('the preview stays pinned while the left column scrolls, then scrolls away', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => window.scrollTo(0, 700));
    // pinned about 16px below the top of the window
    await expect.poll(() => page.evaluate(() => {
      const top = document.querySelector('.previewpanel').getBoundingClientRect().top;
      return top >= 10 && top <= 20;
    })).toBe(true);
    await page.evaluate(() => document.querySelector('.palette').scrollIntoView({ block: 'start' }));
    await expect.poll(() => page.evaluate(() => document.querySelector('.previewpanel').getBoundingClientRect().bottom)).toBeLessThan(900);
  });
});

test.describe('laptop height', () => {
  test.use({ viewport: { width: 1280, height: 780 } });

  test('the whole VS Code preview is visible while pinned', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => window.scrollTo(0, 500));
    await expect.poll(() => page.evaluate(() => {
      const r = document.getElementById('vsc').getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight;
    })).toBe(true);
  });
});

for (const [name, width, height] of [['tablet', 820, 1100], ['phone', 390, 844]]) {
  test.describe(`${name} (${width}px): one column, in reading order`, () => {
    test.use({ viewport: { width, height } });

    test('stacked as options, preview, settings.json, and not pinned', async ({ page }) => {
      await page.goto('/');
      const [c, v, s] = await Promise.all(['.controls', '.previewpanel', '.snippetpanel'].map((q) => box(page, q)));
      expect(c.y).toBeLessThan(v.y);
      expect(v.y).toBeLessThan(s.y);
      expect(Math.abs(c.x - v.x)).toBeLessThan(2);
      expect(await page.evaluate(() => getComputedStyle(document.querySelector('.previewpanel')).position)).toBe('static');
    });
  });
}

test.describe('no horizontal scrolling at any width', () => {
  for (const width of [320, 360, 390, 600, 820, 1024, 1100, 1280, 1440, 1920]) {
    test(`${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/#tidepool--editor--panel--everything');
      expect(await noHorizontalScroll(page)).toBe(true);
    });
  }
});
