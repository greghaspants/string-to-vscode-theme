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

test.describe('a CSS color name or hex in the name field', () => {
  const hint = (page) => page.locator('#seedHint');
  const snippetFor = (E_, seed) => JSON.parse(E_.makeSnippet(E_.buildTheme(seed, 'auto'), { adapt: true, explorer: true, braces: true }));

  test('uses the color\'s hue, says so, and shows the color it was given', async ({ page }) => {
    await page.goto('/#tomato--braces');
    await expect(page.locator('#seed')).toHaveValue('tomato');
    await expect(hint(page)).toHaveText('Using the hue of tomato');
    await expect(hint(page).locator('i')).toHaveCSS('background-color', 'rgb(255, 99, 71)');
    expect(JSON.parse(await snippet(page))).toEqual(snippetFor(E, 'tomato'));
    expect(E.buildTheme('tomato', 'dark').hue).toBeCloseTo(E.hexToOklch('#ff6347').H, 6);
  });

  test('the same color gives the same snippet however it is typed', async ({ page }) => {
    await opt(page, 'optBraces').check();
    const seen = new Set();
    for (const typed of ['tomato', 'Tomato', ' TOMATO ', '#ff6347', '#FF6347', '#ff6347cc', 'rgb(255, 99, 71)', 'hsl(9 100% 64%)']) {
      await page.locator('#seed').fill(typed);
      await expect(hint(page)).toContainText('Using the hue of');
      seen.add(await snippet(page));
    }
    expect(seen.size).toBe(1);
    await page.locator('#seed').fill('teal');
    expect(seen.has(await snippet(page))).toBe(false);
  });

  test('a hex color works and is kept in the link', async ({ page }) => {
    await page.locator('#seed').fill('#ff6600');
    await expect(hint(page)).toHaveText('Using the hue of #ff6600');
    const h = await hash(page);
    expect(h).toBe('#' + E.UrlState.encode(Object.assign({}, E.UrlState.DEFAULTS, { seed: '#ff6600' })));
    await page.goto('about:blank');
    await page.goto('/' + h);
    await expect(page.locator('#seed')).toHaveValue('#ff6600');
    await expect(hint(page)).toHaveText('Using the hue of #ff6600');
  });

  test('spaced and hyphenated names, Tailwind colors and color functions get the same hint', async ({ page }) => {
    for (const typed of ['dark red', 'Dark-Red', 'sky-500', 'Sky', 'amber', 'emerald 600', 'rgb(255 99 71 / 50%)', 'hsl(200 80% 40%)', 'hwb(120 10% 30%)', 'oklch(70% 0.15 300)', '#ff6347cc', '#f63a']) {
      await page.locator('#seed').fill(typed);
      await expect(hint(page), typed).toHaveText('Using the hue of ' + typed.trim());
      await expect(hint(page).locator('i'), typed).toHaveCount(1);
    }
    // the chip shows the color that was typed
    await page.locator('#seed').fill('dark red');
    await expect(hint(page).locator('i')).toHaveCSS('background-color', 'rgb(139, 0, 0)');
    await page.locator('#seed').fill('rgb(200 60 30)');
    await expect(hint(page).locator('i')).toHaveCSS('background-color', 'rgb(200, 60, 30)');
    // a nearly black color has no hue to use, so it says so instead of showing a chip
    await page.locator('#seed').fill('rgb(10 20 30)');
    await expect(hint(page)).toHaveText('rgb(10 20 30) has no clear hue, so it is treated like any other string.');
  });

  test('the same color typed as a name, a function, a Tailwind shade or hex gives the same snippet', async ({ page }) => {
    await opt(page, 'optBraces').check();
    const same = async (typed) => { await page.locator('#seed').fill(typed); await expect(hint(page)).toContainText('Using the hue of'); return snippet(page); };
    const a = await same('dark red');
    for (const typed of ['darkred', 'DARK-RED', 'dark_red', '#8b0000', 'rgb(139 0 0)']) expect(await same(typed), typed).toBe(a);
    const sky = await same('sky');
    for (const typed of ['sky-500', 'Sky 500', E.TAILWIND_COLORS.sky[5]]) expect(await same(typed), typed).toBe(sky);
    expect(sky).not.toBe(a);
  });

  test('the engine reads color functions the way this browser does (rgb, hsl, hwb, oklch, hex with alpha)', async ({ page }) => {
    const samples = ['rgb(255, 99, 71)', 'rgb(10 200 30 / 50%)', 'rgb(100% 0% 50%)', 'rgba(12, 34, 56, .5)', 'hsl(200 80% 40%)', 'hsl(350, 60%, 70%)', 'hsl(0.5turn 50% 50%)', 'hsl(200grad 50% 50%)',
      'hsla(90, 100%, 25%, 0.4)', 'hwb(120 10% 30%)', 'hwb(300 0% 0%)', 'hwb(0 60% 60%)', 'oklch(70% 0.1 300)', 'oklch(0.5 0.1 150)', 'oklch(80% 0.05 30)', 'oklch(60% 0.12 240deg)', '#ff6347cc', '#f63a'];
    const seen = await page.evaluate((list) => list.map((c) => {
      const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#010203'; ctx.fillStyle = c; // an invalid color leaves the sentinel in place
      const rejected = ctx.fillStyle === '#010203';
      ctx.clearRect(0, 0, 1, 1); ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return { rejected, rgb: [d[0], d[1], d[2]] };
    }), samples);
    samples.forEach((c, i) => {
      expect(seen[i].rejected, c).toBe(false);
      const mine = E.parseColor(c).hex;
      const got = [1, 3, 5].map((k) => parseInt(mine.slice(k, k + 2), 16));
      got.forEach((v, k) => expect(Math.abs(v - seen[i].rgb[k]), `${c} channel ${k}: ours ${mine}, browser ${seen[i].rgb}`).toBeLessThanOrEqual(1));
    });
  });

  test('a gray says it has no hue and is treated like any other string', async ({ page }) => {
    await page.locator('#seed').fill('gray');
    await expect(hint(page)).toHaveText('gray has no clear hue, so it is treated like any other string.');
    await expect(hint(page).locator('i')).toHaveCount(0);
    await opt(page, 'optBraces').check();
    expect(JSON.parse(await snippet(page))).toEqual(snippetFor(E, 'gray'));
    expect(E.buildTheme('gray', 'dark').hue).toBe((E.hash32('gray') / 4294967296) * 360);
  });

  test('ordinary names get no hint, and the hint appearing moves nothing', async ({ page }) => {
    await expect(hint(page)).toHaveText('');
    const before = await Promise.all(['.snippetpanel', '#shuffle', '.opts'].map((sel) => page.locator(sel).first().boundingBox()));
    const heightBefore = (await page.locator('#hintWrap').boundingBox()).height; // the row keeps its height with or without a note
    await page.locator('#seed').fill('tomato');
    await expect(hint(page)).toContainText('Using the hue of');
    const after = await Promise.all(['.snippetpanel', '#shuffle', '.opts'].map((sel) => page.locator(sel).first().boundingBox()));
    expect(after).toEqual(before);
    expect((await page.locator('#hintWrap').boundingBox()).height).toBe(heightBefore);
    await page.locator('#seed').fill('tomatoes');
    await expect(hint(page)).toHaveText('');
  });

  test('text that merely contains markup or a color is just a name', async ({ page }) => {
    for (const odd of ['<b>tomato</b>', 'tomato red', 'ff6347', 'facade', 'rgb(255, 99)', 'sky-550', 'red-', 'color(srgb 1 0 0)']) {
      await page.locator('#seed').fill(odd);
      await expect(hint(page)).toHaveText('');
    }
    await expect(page.locator('#seedHint b')).toHaveCount(0);
  });

  test('the engine\'s table of color names matches this browser\'s own, all 148', async ({ page }) => {
    const names = Object.keys(E.CSS_COLORS);
    const got = await page.evaluate((list) => list.map((n) => {
      const el = document.createElement('i'); el.style.color = n; document.body.appendChild(el);
      const c = getComputedStyle(el).color; el.remove(); return c;
    }), names);
    const want = names.map((n) => { const h = E.CSS_COLORS[n]; return `rgb(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)})`; });
    expect(names).toHaveLength(148);
    expect(got).toEqual(want);
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

test.describe('"What can I type?" popup, next to the name label', () => {
  const pop = (page) => page.locator('#typesPop');
  const btn = (page) => page.locator('#typesBtn');

  test('opens on hover, lists every kind of string, and closes when the pointer leaves', async ({ page }) => {
    await expect(pop(page)).toBeHidden();
    await btn(page).hover();
    await expect(pop(page)).toBeVisible();
    for (const heading of ['Any text', 'A color name', 'Hex', 'Tailwind colors', 'Color functions', 'What a color does']) await expect(pop(page)).toContainText(heading);
    await expect(btn(page)).toHaveAttribute('aria-expanded', 'true');
    await page.mouse.move(1000, 700);
    await expect(pop(page)).toBeHidden();
    await expect(btn(page)).toHaveAttribute('aria-expanded', 'false');
  });

  test('stays open while the pointer travels from the "?" into the popup', async ({ page }) => {
    await btn(page).hover();
    const b = await btn(page).boundingBox();
    const box = await pop(page).boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height + 2, { steps: 5 });
    await page.mouse.move(box.x + box.width / 2, box.y + 30, { steps: 10 });
    await expect(pop(page)).toBeVisible();
  });

  test('opens with the keyboard, closes with Escape (focus returns to the "?") or by clicking elsewhere', async ({ page }) => {
    await btn(page).focus();
    await page.keyboard.press('Enter');
    await expect(pop(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(pop(page)).toBeHidden();
    await expect(btn(page)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(pop(page)).toBeVisible();
    await page.mouse.click(1000, 700);
    await expect(pop(page)).toBeHidden();
  });

  test('has a name, and the label still goes to the input', async ({ page }) => {
    await expect(btn(page)).toHaveAccessibleName('What can I type?');
    await expect(btn(page)).toHaveAttribute('aria-controls', 'typesPop');
    await btn(page).hover();
    await expect(pop(page)).toHaveAccessibleName('What can I type?'); // a closed popup is not in the accessibility tree
    await page.mouse.move(1000, 700);
    await page.getByText('Project name (or any text)', { exact: true }).click();
    await expect(page.locator('#seed')).toBeFocused();
  });

  test('every example it shows behaves as it says (all are colors except bare hex digits)', async ({ page }) => {
    const examples = await pop(page).locator('code').allTextContents();
    expect(examples.length).toBeGreaterThanOrEqual(15);
    for (const ex of examples) {
      if (ex === 'ff6600') expect(E.parseColor(ex), ex).toBeNull();
      else if (ex === 'gold') expect(E.parseColor(ex).hue, ex).not.toBeNull();
      else expect(E.parseColor(ex), ex).not.toBeNull();
    }
    expect(E.parseColor('#ff6600cc').hex).toBe('#ff6600'); // "alpha is ignored"
    expect(E.parseColor('red').hex).toBe(E.CSS_COLORS.red);  // "red and green mean the CSS colors"
    expect(E.parseColor('red-500').hex).toBe(E.TAILWIND_COLORS.red[5]);
    expect(E.parseColor('sky').hex).toBe(E.TAILWIND_COLORS.sky[5]); // "a bare name is the 500 shade"
  });
});

test.describe('the "?" on the color note', () => {
  const btn = (page) => page.locator('#hintBtn');
  const pop = (page) => page.locator('#hintPop');

  test('is only there while the note is, and the popup is closed to start with', async ({ page }) => {
    await expect(btn(page)).toBeHidden();
    await page.locator('#seed').fill('tomato');
    await expect(btn(page)).toBeVisible();
    await expect(pop(page)).toBeHidden();
    await page.locator('#seed').fill('tomatoes');
    await expect(btn(page)).toBeHidden();
  });

  test('explains how a color is used, and why a gray is not', async ({ page }) => {
    await page.locator('#seed').fill('tomato');
    await btn(page).hover();
    await expect(pop(page)).toBeVisible();
    await expect(pop(page)).toContainText('The hue comes from your color');
    await expect(pop(page)).toContainText('Same color, same theme');
    await expect(pop(page)).not.toContainText('No hue to borrow', { useInnerText: true }); // the gray text is in the page but hidden
    await page.mouse.move(1000, 700);
    await expect(pop(page)).toBeHidden();

    await page.locator('#seed').fill('gray');
    await btn(page).hover();
    await expect(pop(page)).toBeVisible();
    await expect(pop(page)).toContainText('No hue to borrow');
    await expect(pop(page)).toContainText('hashed like any other string');
    await expect(pop(page)).not.toContainText('The hue comes from your color', { useInnerText: true });
  });

  test('the examples in it are what it says they are', async ({ page }) => {
    await page.locator('#seed').fill('tomato');
    await btn(page).hover();
    const used = await pop(page).locator('[data-hint="used"] code').allTextContents();
    expect(used).toEqual(['gold', 'tomato', '#ff6347', 'rgb(255 99 71)']);
    expect(E.parseColor('gold').hue).not.toBeNull();
    for (const t of ['tomato', '#ff6347', 'rgb(255 99 71)']) expect(E.buildTheme(t, 'dark').palette.sbBg, t).toBe(E.buildTheme('tomato', 'dark').palette.sbBg);
    expect(E.parseColor('ivory').hue).toBeNull(); // the gray example
  });

  test('works from the keyboard, and closes when the text stops being a color', async ({ page }) => {
    await page.locator('#seed').fill('gray');
    await btn(page).focus();
    await page.keyboard.press('Enter');
    await expect(pop(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(pop(page)).toBeHidden();
    await expect(btn(page)).toBeFocused();
    await btn(page).hover();
    await expect(pop(page)).toBeVisible();
    await page.locator('#seed').fill('food');
    await expect(pop(page)).toBeHidden();
    await expect(btn(page)).toBeHidden();
  });
});

test.describe('the "?" popups on a phone', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 320, height: 640 } });
  const fits = async (page, sel) => {
    const box = await page.locator(sel).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  };

  test('a tap opens "What can I type?" inside the screen and a tap elsewhere closes it', async ({ page }) => {
    await page.locator('#typesBtn').tap();
    await expect(page.locator('#typesPop')).toBeVisible();
    await fits(page, '#typesPop');
    await page.locator('h1').tap();
    await expect(page.locator('#typesPop')).toBeHidden();
  });

  test('a tap opens the color note popup inside the screen, and a second tap on the "?" closes it', async ({ page }) => {
    await page.locator('#seed').fill('gray');
    await page.locator('#hintBtn').tap();
    await expect(page.locator('#hintPop')).toBeVisible();
    await fits(page, '#hintPop');
    await page.locator('#hintBtn').tap();
    await expect(page.locator('#hintPop')).toBeHidden();
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
