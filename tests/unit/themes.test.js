'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../../src/engine.js');
const { words } = require('../helpers/words.js');

const HEX = /^#[0-9a-f]{6}$/;
// Fixed odd names first, then every CSS color name, every Tailwind shade, color functions and a hex sweep (hue-controlled inputs), then 1,500 pseudo-random names.
const TAILWIND_SEEDS = Object.entries(E.TAILWIND_COLORS).flatMap(([fam, shades]) => shades.map((_, i) => `${fam}-${E.TAILWIND_SHADES[i]}`));
const COLOR_SEEDS = Object.keys(E.CSS_COLORS).concat(TAILWIND_SEEDS, Array.from({ length: 72 }, (_, i) => E.oklchToHex(0.62, 0.15, i * 5)),
  ['rgb(255 99 71)', 'hsl(200 80% 40%)', 'hwb(120 10% 30%)', 'oklch(70% 0.15 300)', 'oklch(70% 0.4 150)', 'dark red', '#ff6347cc']);
const SEEDS = ['food', 'foods', '', 'Hello World', 'a', 'b', 'ñandú', '🚀'].concat(COLOR_SEEDS, words(1500));
const MODES = ['dark', 'light'];

test('every contrast check passes for every generated theme', () => {
  const failures = {};
  let themes = 0;
  let tightest = Infinity;
  for (const seed of SEEDS) {
    for (const mode of MODES) {
      themes++;
      for (const c of E.buildTheme(seed, mode).checks) {
        tightest = Math.min(tightest, c.ratio / c.min);
        if (!c.pass) failures[`${mode} | ${c.label}`] = (failures[`${mode} | ${c.label}`] || 0) + 1;
      }
    }
  }
  assert.ok(themes >= 3000);
  assert.deepEqual(failures, {}, 'checks below their WCAG target (body 7:1, text 4.5:1, non-text 3:1)');
  assert.ok(tightest >= 1, `closest check is at ${tightest.toFixed(4)} of its target`);
});

test('every color is a lowercase #rrggbb hex', () => {
  const bad = [];
  for (const seed of SEEDS.slice(0, 300)) {
    for (const mode of MODES) {
      const t = E.buildTheme(seed, mode);
      for (const [k, v] of Object.entries(t.colors)) if (!HEX.test(v)) bad.push(`${seed}/${mode} ${k}=${v}`);
      for (const [k, v] of Object.entries(t.tok)) if (!HEX.test(v)) bad.push(`${seed}/${mode} tok.${k}=${v}`);
      for (const r of t.textMateRules) if (!HEX.test(r.settings.foreground)) bad.push(`${seed}/${mode} rule ${r.scope[0]}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('the same name always gives the same colors', () => {
  for (const seed of ['food', 'Hello World', '🚀', 'tidepool']) {
    for (const mode of ['auto', 'dark', 'light']) {
      assert.equal(JSON.stringify(E.buildTheme(seed, mode)), JSON.stringify(E.buildTheme(seed, mode)));
    }
  }
  // Surrounding whitespace is not part of the name.
  assert.equal(JSON.stringify(E.buildTheme('  food ', 'dark')), JSON.stringify(E.buildTheme('food', 'dark')));
  assert.notEqual(E.buildTheme('food', 'dark').colors['titleBar.activeBackground'], E.buildTheme('foods', 'dark').colors['titleBar.activeBackground']);
});

test('auto picks dark or light from the name, and an explicit mode is honored', () => {
  for (const seed of words(50)) {
    assert.equal(E.buildTheme(seed, 'dark').dark, true);
    assert.equal(E.buildTheme(seed, 'light').dark, false);
    assert.equal(E.buildTheme(seed, 'auto').dark, E.buildTheme(seed, 'auto').dark);
  }
});

test('syntax colors stay distinguishable, including for color-blind viewers (regression floors)', () => {
  // Smallest OKLab distance between any two of the six syntax colors and plain text, over all test themes.
  // The floors sit just under today's observed minimum, so the algorithm can only get better.
  const floors = { normal: 0.05, protan: 0.025, deutan: 0.03, tritan: 0.03 };
  const mins = { normal: Infinity, protan: Infinity, deutan: Infinity, tritan: Infinity };
  for (const seed of SEEDS) for (const mode of MODES) for (const v of E.buildTheme(seed, mode).cvd) mins[v.view] = Math.min(mins[v.view], v.min);
  for (const view of Object.keys(floors)) assert.ok(mins[view] >= floors[view], `${view}: ${mins[view].toFixed(4)} < ${floors[view]}`);
});

test('similar names do not get similar hues', () => {
  let close = 0;
  const list = words(400);
  for (const w of list) {
    const d = Math.abs(E.buildTheme(w, 'dark').hue - E.buildTheme(w + 's', 'dark').hue);
    if (Math.min(d, 360 - d) < 20) close++;
  }
  // Random hues land within 20 degrees about 11% of the time.
  assert.ok(close / list.length < 0.2, `${close} of ${list.length} within 20 degrees`);
});

test('every option group exists in the theme, and the groups do not overlap', () => {
  const t = E.buildTheme('food', 'dark');
  const groups = { frame: E.FRAME_KEYS, explorer: E.EXPLORER_KEYS, editor: E.EDITOR_KEYS, panel: E.PANEL_KEYS };
  const seen = new Map();
  for (const [name, keys] of Object.entries(groups)) {
    for (const k of keys) {
      assert.match(t.colors[k] || '', HEX, `${name} key ${k} is missing from the theme`);
      assert.equal(seen.get(k), undefined, `${k} is in both ${seen.get(k)} and ${name}`);
      seen.set(k, name);
    }
    assert.equal(new Set(keys).size, keys.length, `${name} has duplicate keys`);
  }
  assert.equal(E.PANEL_KEYS.length, 25); // panel, panel title, terminal base, cursor, 16 ANSI colors
});

test('the title bar, activity bar and status bar share one accent', () => {
  for (const seed of words(100)) for (const mode of MODES) {
    const c = E.buildTheme(seed, mode).colors;
    assert.equal(c['titleBar.activeBackground'], c['activityBar.background']);
    assert.equal(c['titleBar.activeBackground'], c['statusBar.background']);
  }
});

test('every contrast check belongs to a known option area', () => {
  const t = E.buildTheme('food', 'dark');
  const areas = new Set(t.checks.map((c) => c.area));
  assert.deepEqual([...areas].sort(), ['all', 'editor', 'explorer', 'frame', 'panel']);
  for (const area of areas) assert.ok(t.checks.filter((c) => c.area === area).length > 0);
});

test('the frame is identical in the dark and light versions of every name', () => {
  // This is what lets the snippet keep the frame outside the light/dark scoped blocks.
  const diffs = [];
  for (const seed of SEEDS) {
    const d = E.buildTheme(seed, 'dark'), l = E.buildTheme(seed, 'light');
    for (const k of E.FRAME_KEYS) if (d.colors[k] !== l.colors[k]) diffs.push(`${seed} ${k}`);
  }
  assert.deepEqual(diffs.slice(0, 5), []);
});

test('about a third of ordinary strings get a bright bar with dark text, spread over lightness, and the rest are dark with light text', () => {
  const seeds = []; for (let i = 0; i < 3000; i++) seeds.push(`project-${i}`);
  let bright = 0; const ls = [];
  for (const s of seeds) {
    const t = E.buildTheme(s, 'dark');
    const L = E.hexToOklch(t.colors['statusBar.background']).L;
    const fgL = E.hexToOklch(t.colors['statusBar.foreground']).L;
    if (t.brightBar) { bright++; ls.push(L); assert.ok(fgL < L, `${s}: dark text`); assert.ok(L >= 0.6 && L <= 0.9, `${s}: L ${L}`); }
    else { assert.ok(fgL > L, `${s}: light text`); assert.ok(L <= 0.47, `${s}: L ${L}`); }
    assert.ok(E.contrast(t.colors['statusBar.foreground'], t.colors['statusBar.background']) >= 4.5, s);
  }
  const share = bright / seeds.length;
  assert.ok(share > 0.3 && share < 0.4, `share ${share}`);
  ls.sort((a, b) => a - b);
  assert.ok(ls[Math.floor(ls.length * 0.1)] < 0.72 && ls[Math.floor(ls.length * 0.9)] > 0.82, 'lightness is spread, not a single value');
});

test('the bright or dark choice for a string does not depend on the mode, and does not change anything but the frame', () => {
  const FRAME = new Set(E.FRAME_KEYS);
  for (let i = 0; i < 200; i++) {
    const s = `choice-${i}`;
    const d = E.buildTheme(s, 'dark'), l = E.buildTheme(s, 'light');
    assert.equal(d.brightBar, l.brightBar, s);
    for (const k of E.FRAME_KEYS) assert.equal(d.colors[k], l.colors[k], `${s} ${k}`);
    assert.equal(d.palette.sbBg, l.palette.sbBg);
    // another string's theme with the same hue and mode has the same non-frame structure: same keys
    assert.deepEqual(Object.keys(d.colors).filter((k) => FRAME.has(k)).sort(), E.FRAME_KEYS.slice().sort());
  }
});

test('the title bar search box (command center) follows the bar: text, outline and hover, in every theme and both modes', () => {
  const CC = ['commandCenter.foreground', 'commandCenter.activeForeground', 'commandCenter.inactiveForeground', 'commandCenter.background', 'commandCenter.activeBackground', 'commandCenter.border', 'commandCenter.activeBorder', 'commandCenter.inactiveBorder'];
  for (const k of CC) assert.ok(E.FRAME_KEYS.includes(k), `${k} is a frame key`);
  const seeds = ['food', 'yellow', 'gold', 'white', 'black', 'gray', 'teal', 'navy', 'alpha', 'cherry', 'tomato', 'sky-300', 'sky-700', '#ffeb3b'].concat(words(150));
  for (const s of seeds) for (const mode of ['dark', 'light']) {
    const t = E.buildTheme(s, mode), c = t.colors;
    for (const k of CC) assert.match(c[k], HEX, `${s} ${k}`);
    assert.equal(c['commandCenter.foreground'], c['titleBar.activeForeground'], s);
    assert.equal(c['commandCenter.activeForeground'], c['titleBar.activeForeground'], s);
    assert.equal(c['commandCenter.inactiveForeground'], c['titleBar.inactiveForeground'], s);
    assert.equal(c['commandCenter.background'], c['titleBar.activeBackground'], s);
    assert.equal(c['commandCenter.activeBackground'], c['statusBarItem.hoverBackground'], s);
    // readable: text on the box at rest and hovered (4.5:1), the outline against the bar (3:1)
    for (const bg of ['commandCenter.background', 'commandCenter.activeBackground']) assert.ok(E.contrast(c['commandCenter.foreground'], c[bg]) >= 4.5, `${s} ${mode} text on ${bg}`);
    assert.ok(E.contrast(c['commandCenter.inactiveForeground'], c['commandCenter.background']) >= 4.5, `${s} ${mode} inactive text`);
    for (const k of ['commandCenter.border', 'commandCenter.activeBorder', 'commandCenter.inactiveBorder']) assert.ok(E.contrast(c[k], c['titleBar.activeBackground']) >= 3, `${s} ${mode} ${k}`);
    for (const label of ['Command center text, resting and on hover', 'Command center text in an inactive window', 'Command center outline']) assert.ok(t.checks.find((x) => x.label === label && x.pass), `${s} ${label}`);
  }
});

test('hashing ignores case: the same text in any capitalization is the same theme', () => {
  const same = (a, b) => {
    for (const mode of ['dark', 'light', 'auto']) {
      const x = E.buildTheme(a, mode), y = E.buildTheme(b, mode);
      assert.deepEqual(Object.assign({}, x, { seed: '' }), Object.assign({}, y, { seed: '' }), `${a} vs ${b} (${mode})`);
      assert.equal(E.makeSnippet(x, { adapt: true, editor: true, braces: true }), E.makeSnippet(y, { adapt: true, editor: true, braces: true }));
    }
  };
  same('food', 'Food'); same('food', 'FOOD'); same('Hello World', 'hello world'); same('My-Project', 'my-project');
  same('ñandú', 'ÑANDÚ'); same('Ünïcode Näme', 'ünïcode näme');
  for (const w of words(60)) same(w, w.toUpperCase()), same(w, w[0].toUpperCase() + w.slice(1));
  // the text is still shown as typed
  assert.equal(E.buildTheme('Hello World', 'dark').seed, 'Hello World');
  // different text is still different
  assert.notEqual(E.buildTheme('food', 'dark').colors['titleBar.activeBackground'], E.buildTheme('foods', 'dark').colors['titleBar.activeBackground']);
  // and surrounding spaces still do not matter
  same('  Food ', 'food');
});
