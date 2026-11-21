'use strict';
const { test, expect } = require('@playwright/test');
const E = require('../../src/engine.js');
const { shuffleWords } = require('../helpers/words.js');

const hash = (page) => page.evaluate(() => location.hash);
const snippet = (page) => page.locator('#snippet').textContent();
const opt = (page, id) => page.locator('#' + id);
const radioLabel = (page, group, text) => page.locator(`#${group} label`).filter({ hasText: text });

test.use({ viewport: { width: 1280, height: 900 } });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // The page fades colors over 250ms. Switch that off so tests read final colors, not mid-fade ones.
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
});

test.describe('page basics', () => {
  test('says plainly that it is not affiliated with VS Code', async ({ page }) => {
    await expect(page.locator('#disclaimer')).toHaveText('Not affiliated with VS Code. This is just something a random person built for fun, and it is very vibe coded.');
    await expect(page.locator('#disclaimer')).toBeVisible();
  });

  test('has the right title and heading and is themed on first paint', async ({ page }) => {
    await expect(page).toHaveTitle('String-to-VS-Code-theme util');
    await expect(page.locator('h1')).toHaveText('String-to-VS-Code*-theme util');
    expect(await snippet(page)).toMatch(/^"workbench\.colorCustomizations": \{/);
    // The default name "food" produces this accent, from the engine in src/.
    const accent = E.buildTheme('food', 'auto').colors['titleBar.activeBackground'];
    expect(await snippet(page)).toContain(`"titleBar.activeBackground": "${accent}"`);
  });

  test('makes no requests beyond the page itself and logs no errors', async ({ page, baseURL }) => {
    const requests = [];
    const problems = [];
    page.on('request', (r) => requests.push(r.url()));
    page.on('pageerror', (e) => problems.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
    await page.goto('about:blank'); // start over so the page load itself is observed
    await page.goto('/#tidepool--editor--panel');
    expect(requests.some((u) => u.startsWith(new URL(baseURL).origin))).toBe(true);
    await page.locator('#shuffle').click();
    await page.locator('#visionSeg label').filter({ hasText: 'Protanopia' }).click();
    const origin = new URL(baseURL).origin;
    const foreign = requests.filter((u) => !u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:'));
    expect(foreign, 'system fonts only, no CDN, no analytics').toEqual([]);
    expect(problems).toEqual([]);
  });

  test('the report says every check passes, in the default setup and with everything on', async ({ page }) => {
    const parse = async () => {
      const m = (await page.locator('#summary .big').textContent()).match(/(\d+) of (\d+)/);
      return [Number(m[1]), Number(m[2])];
    };
    let [pass, total] = await parse();
    expect(total).toBeGreaterThan(0);
    expect(pass).toBe(total);
    await opt(page, 'optEvery').check();
    const next = await parse();
    expect(next[1]).toBeGreaterThan(total);
    expect(next[0]).toBe(next[1]);
  });

  test('the apply steps only mention workspace settings', async ({ page }) => {
    const steps = await page.locator('.steps').innerText();
    expect(steps).toContain('Open Workspace Settings (JSON)');
    expect(steps).toContain('.vscode/settings.json');
    expect(steps).not.toMatch(/user settings/i);
  });
});

test.describe('name, link and sharing', () => {
  test('typing a name updates the snippet and the link', async ({ page }) => {
    await page.locator('#seed').fill('tidepool');
    await expect.poll(() => hash(page)).toBe('#tidepool');
    const accent = E.buildTheme('tidepool', 'auto').colors['titleBar.activeBackground'];
    expect(await snippet(page)).toContain(`"titleBar.activeBackground": "${accent}"`);
  });

  test('the same name gives the same snippet after a reload', async ({ page }) => {
    await page.locator('#seed').fill('Hello World');
    await expect.poll(() => hash(page)).toMatch(/^#--s-/); // not writable as a plain name, so it is base32-encoded
    const before = await snippet(page);
    await page.reload();
    await expect(page.locator('#seed')).toHaveValue('Hello World');
    expect(await snippet(page)).toBe(before);
  });

  test('opening a link restores every option', async ({ page }) => {
    await page.goto('/#tidepool--light--editor--panel--no-explorer--braces');
    await expect(page.locator('#seed')).toHaveValue('tidepool');
    await expect(opt(page, 'optEditor')).toBeChecked();
    await expect(opt(page, 'optPanel')).toBeChecked();
    await expect(opt(page, 'optExplorer')).not.toBeChecked();
    await expect(opt(page, 'optBraces')).toBeChecked();
    await expect(radioLabel(page, 'pmodeSeg', 'Light mode').locator('input')).toBeChecked();
    expect(await snippet(page)).toMatch(/^\{\n/);

    await page.goto('about:blank'); // a fresh load, not just a hash change
    await page.goto('/#tidepool--no-adapt--dark');
    await expect(opt(page, 'optAdapt')).not.toBeChecked();
    await expect(radioLabel(page, 'modeSeg', 'Dark').locator('input')).toBeChecked();
  });

  test('editing the link by hand (hashchange) updates the page', async ({ page }) => {
    await page.evaluate(() => { location.hash = '#quarry--editor'; });
    await expect(page.locator('#seed')).toHaveValue('quarry');
    await expect(opt(page, 'optEditor')).toBeChecked();
  });

  test('only non-default inputs appear in the link', async ({ page }) => {
    expect(await hash(page)).toBe('');
    await opt(page, 'optPanel').check();
    await expect.poll(() => hash(page)).toBe('#--panel');
    await opt(page, 'optPanel').uncheck();
    await expect.poll(() => hash(page)).toBe('');
  });

  test('"Try a random word" picks a new word from the list', async ({ page }) => {
    await page.locator('#shuffle').click();
    const word = await page.locator('#seed').inputValue();
    expect(shuffleWords()).toContain(word);
    expect(word).not.toBe('food');
    await expect.poll(() => hash(page)).toBe('#' + E.UrlState.encode(Object.assign({}, E.UrlState.DEFAULTS, { seed: word })));
  });

  test('"Try a random word" can reach every word in the list, and never repeats the current one', async ({ page }) => {
    const list = shuffleWords();
    let previous = 'food';
    for (let i = 0; i < list.length; i++) {
      // Make Math.random point at word i first, then walk the list, so the page's "not the current word" loop cannot spin forever.
      await page.evaluate(([at, n]) => { let calls = 0; Math.random = () => (((at + calls++) % n) + 0.5) / n; }, [i, list.length]);
      await page.locator('#shuffle').click();
      await expect(page.locator('#seed')).toHaveValue(list[i]);
      expect(list[i]).not.toBe(previous);
      await expect.poll(() => hash(page)).toBe('#' + E.UrlState.encode(Object.assign({}, E.UrlState.DEFAULTS, { seed: list[i] })));
      previous = list[i];
    }
  });

  test('Copy puts exactly the snippet on the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.locator('#copy').click();
    await expect(page.locator('#copied')).toContainText('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await snippet(page));
  });
});

test.describe('what to color', () => {
  test('the options are labeled for what they color', async ({ page }) => {
    await expect(page.locator('.what label b')).toHaveText([
      'Color the side bars',
      'Color the coding palette',
      'Color the panel and terminal',
      'Color everything'
    ]);
  });

  test('side bars are on by default; the coding palette and panel are opt-in', async ({ page }) => {
    const s = await snippet(page);
    expect(s).toContain('"sideBar.background"');
    expect(s).not.toContain('"editor.background"');
    expect(s).not.toContain('"panel.background"');
    expect(s).toContain('"[*Dark*]"');
    expect(s).toContain('"[*Light*]"');
    expect(s).not.toContain('workbench.colorTheme');
  });

  test('each option adds its own keys and nothing else', async ({ page }) => {
    await opt(page, 'optPanel').check();
    let s = await snippet(page);
    expect(s).toContain('"panel.background"');
    expect(s).toContain('"terminal.ansiRed"');
    expect(s).not.toContain('"editor.background"');

    await opt(page, 'optEditor').check();
    s = await snippet(page);
    expect(s).toContain('"editor.background"');
    expect(s).toContain('"editor.tokenColorCustomizations"');

    await opt(page, 'optExplorer').uncheck();
    s = await snippet(page);
    expect(s).not.toContain('"sideBar.background"');
    expect(s).toContain('"titleBar.activeBackground"'); // the frame is always there
    expect(s).toContain('"statusBar.background"');
    expect(s).toContain('"activityBar.background"');
  });

  test('the preview only colors the areas you picked', async ({ page }) => {
    const bg = (sel) => page.evaluate((q) => getComputedStyle(document.querySelector(q)).backgroundColor, sel);
    const before = await bg('.panelarea');
    await opt(page, 'optPanel').check();
    expect(await bg('.panelarea')).not.toBe(before);
    await opt(page, 'optPanel').uncheck();
    expect(await bg('.panelarea')).toBe(before);
  });

  test('Color everything ticks and locks the other three, and unticking restores them', async ({ page }) => {
    await opt(page, 'optEditor').check();
    await opt(page, 'optEvery').check();
    for (const id of ['optExplorer', 'optEditor', 'optPanel']) {
      await expect(opt(page, id)).toBeChecked();
      await expect(opt(page, id)).toBeDisabled();
    }
    await expect.poll(() => hash(page)).toBe('#--editor--everything');
    expect(await snippet(page)).toContain('"button.background"');

    await opt(page, 'optEvery').uncheck();
    await expect(opt(page, 'optExplorer')).toBeEnabled();
    await expect(opt(page, 'optEditor')).toBeChecked();
    await expect(opt(page, 'optPanel')).not.toBeChecked();
  });

  test('the base-theme option is only available with Color everything and matching off', async ({ page }) => {
    await expect(opt(page, 'optBase')).toBeDisabled();
    await opt(page, 'optAdapt').uncheck();
    await expect(opt(page, 'optBase')).toBeDisabled(); // still needs Color everything
    await opt(page, 'optEvery').check();
    await expect(opt(page, 'optBase')).toBeEnabled();
    expect(await snippet(page)).toContain('"workbench.colorTheme"');
    await opt(page, 'optBase').uncheck();
    expect(await snippet(page)).not.toContain('"workbench.colorTheme"');
    await expect.poll(() => hash(page)).toContain('no-base');
  });

  test('semantic tokens need the coding palette', async ({ page }) => {
    await expect(opt(page, 'optSem')).toBeDisabled();
    await opt(page, 'optEditor').check();
    await expect(opt(page, 'optSem')).toBeEnabled();
    expect(await snippet(page)).toContain('editor.semanticTokenColorCustomizations');
    await opt(page, 'optSem').uncheck();
    expect(await snippet(page)).not.toContain('editor.semanticTokenColorCustomizations');
  });

  test('the braces option wraps the snippet for an empty settings.json', async ({ page }) => {
    expect(await snippet(page)).toMatch(/,$/);
    await opt(page, 'optBraces').check();
    const s = await snippet(page);
    expect(() => JSON.parse(s)).not.toThrow();
  });

  test('the snippet is valid JSON for every combination of options', async ({ page }) => {
    for (const adapt of [true, false]) {
      await opt(page, 'optAdapt').setChecked(adapt);
      for (const id of ['optEditor', 'optPanel', 'optEvery']) {
        await opt(page, id).check();
        await opt(page, 'optBraces').check();
        const json = JSON.parse(await snippet(page));
        expect(Object.keys(json['workbench.colorCustomizations']).length).toBeGreaterThan(E.FRAME_KEYS.length);
      }
      await opt(page, 'optEvery').uncheck();
      await opt(page, 'optEditor').uncheck();
      await opt(page, 'optPanel').uncheck();
      await opt(page, 'optBraces').uncheck();
    }
  });
});

test.describe('light and dark', () => {
  test('with matching on, Light mode / Dark mode only switch the preview', async ({ page }) => {
    await expect(page.locator('#pmodeBox')).toBeVisible();
    await expect(page.locator('#brightBox')).toBeHidden();
    const before = await snippet(page);
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const darkBg = await bg();
    await radioLabel(page, 'pmodeSeg', 'Light mode').click();
    await expect.poll(() => hash(page)).toBe('#--light');
    expect(await bg()).not.toBe(darkBg);
    expect(await snippet(page)).toBe(before);
  });

  test('with matching off, Theme brightness replaces the preview switch and shapes the snippet', async ({ page }) => {
    await opt(page, 'optAdapt').uncheck();
    await expect(page.locator('#brightBox')).toBeVisible();
    await expect(page.locator('#pmodeBox')).toBeHidden();
    expect(await snippet(page)).not.toContain('[*Dark*]');
    await radioLabel(page, 'modeSeg', 'Light').click();
    await expect.poll(() => hash(page)).toBe('#--light--no-adapt');
    const light = E.buildTheme('food', 'light').colors['sideBar.background'];
    expect(await snippet(page)).toContain(`"sideBar.background": "${light}"`);
  });

  test('the title bar, activity bar and status bar never change between light and dark', async ({ page }) => {
    const frame = () => page.evaluate(() => ['.vsc .title', '.vsc .actbar', '.vsc .status'].map((q) => {
      const el = document.querySelector(q);
      return el ? getComputedStyle(el).backgroundColor : null;
    }));
    const dark = await frame();
    await radioLabel(page, 'pmodeSeg', 'Light mode').click();
    expect(await frame()).toEqual(dark);
    const s = await snippet(page);
    const accent = E.buildTheme('food', 'light').colors['titleBar.activeBackground'];
    expect(accent).toBe(E.buildTheme('food', 'dark').colors['titleBar.activeBackground']);
    expect(s).toContain(accent);
  });
});

test.describe('color-blind preview', () => {
  test('each vision type applies a filter to the preview, and Normal removes it', async ({ page }) => {
    for (const [label, id] of [['Protanopia', 'cvd-protan'], ['Deuteranopia', 'cvd-deutan'], ['Tritanopia', 'cvd-tritan'], ['Grayscale', 'cvd-gray']]) {
      await radioLabel(page, 'visionSeg', label).click();
      await expect(page.locator('#vsc')).toHaveCSS('filter', /url/);
      expect(await page.evaluate(() => document.getElementById('vsc').style.filter)).toContain(id);
    }
    await radioLabel(page, 'visionSeg', 'Normal').click();
    expect(await page.evaluate(() => document.getElementById('vsc').style.filter)).toBe('none');
  });
});

test.describe('"Why?" popup', () => {
  test('opens on hover and closes when the pointer leaves', async ({ page }) => {
    const pop = page.locator('#whyPop');
    await expect(pop).toBeHidden();
    await page.locator('#whyBtn').hover();
    await expect(pop).toBeVisible();
    await expect(pop).toContainText('Why a string?');
    await page.mouse.move(1000, 600);
    await expect(pop).toBeHidden();
  });

  test('stays open while the pointer travels from the button into the popup', async ({ page }) => {
    const pop = page.locator('#whyPop');
    await page.locator('#whyBtn').hover();
    const box = await pop.boundingBox();
    const btn = await page.locator('#whyBtn').boundingBox();
    await page.mouse.move(btn.x + btn.width / 2, btn.y + btn.height + 2, { steps: 5 });
    await page.mouse.move(box.x + box.width / 2, box.y + 20, { steps: 10 });
    await expect(pop).toBeVisible();
  });

  test('opens with the keyboard and closes with Escape, returning focus to the button', async ({ page }) => {
    await page.locator('#whyBtn').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#whyPop')).toBeVisible();
    await expect(page.locator('#whyBtn')).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(page.locator('#whyPop')).toBeHidden();
    await expect(page.locator('#whyBtn')).toBeFocused();
  });
});

test.describe('"Why?" popup on touch screens', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('a tap opens it and a tap elsewhere closes it', async ({ page }) => {
    await page.locator('#whyBtn').tap();
    await expect(page.locator('#whyPop')).toBeVisible();
    await page.locator('h1').tap();
    await expect(page.locator('#whyPop')).toBeHidden();
  });
});

test.describe('"VS-Code*" note', () => {
  const NOTE = 'and other editors built on VS Code (results may vary)';

  test('the asterisk sits right after "VS-Code" and the heading keeps its plain name', async ({ page }) => {
    await expect(page.locator('h1')).toHaveText('String-to-VS-Code*-theme util');
    await expect(page.getByRole('heading', { name: 'String-to-VS-Code-theme util' })).toBeVisible();
    await expect(page.locator('#starBtn')).toHaveText('*');
    await expect(page.locator('#starBtn')).toHaveAccessibleDescription(NOTE);
    await expect(page.locator('#starTip')).toBeHidden();
  });

  test('opens on hover and closes when the pointer leaves', async ({ page }) => {
    const tip = page.locator('#starTip');
    await page.locator('#starBtn').hover();
    await expect(tip).toBeVisible();
    await expect(tip).toHaveText(NOTE);
    await expect(page.locator('#starBtn')).toHaveAttribute('aria-expanded', 'true');
    await page.mouse.move(1000, 600);
    await expect(tip).toBeHidden();
    await expect(page.locator('#starBtn')).toHaveAttribute('aria-expanded', 'false');
  });

  test('a click while hovering keeps it open; leaving still closes it', async ({ page }) => {
    const tip = page.locator('#starTip');
    await page.locator('#starBtn').click();
    await expect(tip).toBeVisible();
    await page.mouse.move(1000, 600);
    await expect(tip).toBeHidden();
  });

  test('opens with the keyboard, then closes by clicking elsewhere', async ({ page }) => {
    const tip = page.locator('#starTip');
    await page.locator('#starBtn').focus();
    await page.keyboard.press('Enter');
    await expect(tip).toBeVisible();
    await page.mouse.click(1000, 600);
    await expect(tip).toBeHidden();
  });

  test('a press elsewhere closes it even if the asterisk never had focus (Safari does not focus buttons)', async ({ page }) => {
    const tip = page.locator('#starTip');
    await page.locator('#starBtn').hover();
    await expect(tip).toBeVisible();
    await expect(page.locator('#starBtn')).not.toBeFocused();
    // Dispatched, not clicked: moving the mouse away would close it through the hover path instead.
    await page.evaluate(() => document.querySelector('.lede').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' })));
    await expect(tip).toBeHidden();
  });

  test('closes with Escape, and a second keyboard press toggles it', async ({ page }) => {
    const tip = page.locator('#starTip');
    await page.locator('#starBtn').focus();
    await page.keyboard.press('Enter');
    await expect(tip).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(tip).toBeHidden();
    await page.keyboard.press('Enter');
    await expect(tip).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(tip).toBeHidden();
  });

  test('appears just under the asterisk', async ({ page }) => {
    await page.locator('#starBtn').hover();
    const [btn, tip] = await Promise.all([page.locator('#starBtn').boundingBox(), page.locator('#starTip').boundingBox()]);
    expect(tip.y).toBeGreaterThanOrEqual(btn.y + btn.height - 1);
    expect(tip.y).toBeLessThan(btn.y + btn.height + 30);
    const mid = btn.x + btn.width / 2;
    expect(mid).toBeGreaterThanOrEqual(tip.x);
    expect(mid).toBeLessThanOrEqual(tip.x + tip.width);
  });

  test('showing it does not move anything on the page', async ({ page }) => {
    const before = await page.locator('.studio').boundingBox();
    await page.locator('#starBtn').hover();
    await expect(page.locator('#starTip')).toBeVisible();
    expect(await page.locator('.studio').boundingBox()).toEqual(before);
  });
});

test.describe('"VS-Code*" note on touch screens', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 320, height: 640 } });

  test('a tap opens it inside the screen, a second tap or a tap elsewhere closes it', async ({ page }) => {
    const tip = page.locator('#starTip');
    await page.locator('#starBtn').tap();
    await expect(tip).toBeVisible();
    const box = await tip.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
    await page.locator('#starBtn').tap();
    await expect(tip).toBeHidden();
    await page.locator('#starBtn').tap();
    await expect(tip).toBeVisible();
    await page.locator('.lede').tap();
    await expect(tip).toBeHidden();
  });
});
