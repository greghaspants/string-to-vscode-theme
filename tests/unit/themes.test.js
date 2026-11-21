'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../../src/engine.js');
const { words } = require('../helpers/words.js');

const HEX = /^#[0-9a-f]{6}$/;
const SEEDS = ['food', 'foods', '', 'Hello World', 'a', 'b', 'ñandú', '🚀'].concat(words(1500));
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
