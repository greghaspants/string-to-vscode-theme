'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../../src/engine.js');

const NAMES = Object.keys(E.CSS_COLORS);
const GRAYS = NAMES.filter((n) => E.parseColor(n).hue === null);
const CHROMATIC = NAMES.filter((n) => E.parseColor(n).hue !== null);
const MODES = ['auto', 'dark', 'light'];
const sameTheme = (a, b) => JSON.stringify([a.hue, a.dark, a.colors, a.textMateRules, a.semanticRules, a.palette]) === JSON.stringify([b.hue, b.dark, b.colors, b.textMateRules, b.semanticRules, b.palette]);

test('the table has the 148 CSS Color Level 4 names, each a lowercase #rrggbb', () => {
  assert.equal(NAMES.length, 148);
  for (const [n, hex] of Object.entries(E.CSS_COLORS)) {
    assert.match(n, /^[a-z]+$/);
    assert.match(hex, /^#[0-9a-f]{6}$/, n);
  }
  assert.equal(E.CSS_COLORS.tomato, '#ff6347');
  assert.equal(E.CSS_COLORS.rebeccapurple, '#663399');
  assert.equal(E.CSS_COLORS.gray, E.CSS_COLORS.grey);
  assert.ok(Object.isFrozen(E.CSS_COLORS));
});

test('parseColor reads names, hex, Tailwind colors and color functions, and nothing else', () => {
  for (const ok of ['tomato', 'Tomato', 'TOMATO', '  tomato  ', '#ff6347', '#FF6347', '#ff6347cc', '#FF6347FF', '#f63a'.replace('f63a', 'ff63')]) {
    if (ok === '#ff63') continue; // a 4-digit hex is #rgba: ff63 means #ffff6633, which is yellow, not tomato
    assert.equal(E.parseColor(ok).hex, '#ff6347', ok);
  }
  assert.equal(E.parseColor('#f63').hex, '#ff6633');
  assert.equal(E.parseColor('#f63a').hex, '#ff6633'); // alpha ignored
  assert.equal(E.parseColor('#ff63').hex, '#ffff66');  // #rgba: r=f g=f b=6 a=3
  assert.equal(E.parseColor('tomato').kind, 'name');
  assert.equal(E.parseColor('#f63').kind, 'hex');
  assert.equal(E.parseColor('sky-500').kind, 'tailwind');
  assert.equal(E.parseColor('rgb(1 2 3)').kind, 'function');
  const notColors = ['', ' ', 'food', 'tidepool', 'ff6347', 'f63', 'facade', 'bad', '#ff634', '#ff63477', '#gg0000', '#', '#12345', 'tomato red', 'sky-550', 'sky-5', 'sky-5000',
    'constructor', 'toString', '__proto__', 'hasOwnProperty', 'transparent', 'currentcolor', 'my (project)', null, undefined];
  for (const bad of notColors) assert.equal(E.parseColor(bad), null, String(bad));
});

test('CSS names ignore case, spaces, hyphens and underscores: "dark red" is darkred', () => {
  for (const typed of ['darkred', 'Dark Red', 'DARK-RED', 'dark_red', ' dark  -  red ']) assert.equal(E.parseColor(typed).hex, '#8b0000', typed);
  assert.equal(E.parseColor('light sea green').hex, E.CSS_COLORS.lightseagreen);
  assert.equal(E.parseColor('rebecca purple').hex, '#663399');
  assert.equal(E.parseColor('dark grey').hex, E.CSS_COLORS.darkgrey);
  assert.equal(E.parseColor('-'), null);
  assert.equal(E.parseColor(' - _ '), null);
});

test('Tailwind: 26 families, 11 shades each, in the order Tailwind lists them', () => {
  assert.deepEqual(Object.keys(E.TAILWIND_COLORS), ['red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
    'slate', 'gray', 'zinc', 'neutral', 'stone', 'mauve', 'olive', 'mist', 'taupe']);
  assert.deepEqual(E.TAILWIND_SHADES, [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]);
  for (const [fam, shades] of Object.entries(E.TAILWIND_COLORS)) {
    assert.equal(shades.length, 11, fam);
    for (const hex of shades) assert.match(hex, /^#[0-9a-f]{6}$/, fam);
    assert.ok(Object.isFrozen(shades));
  }
  assert.ok(Object.isFrozen(E.TAILWIND_COLORS));
});

test('Tailwind hues are Tailwind\'s own (the OKLCH hues in its theme)', () => {
  const want = { 'sky-500': 237.323, 'red-500': 25.331, 'emerald-500': 162.48, 'amber-500': 70.08, 'violet-500': 293.541, 'rose-500': 16.935, 'slate-500': 257.417 };
  for (const [name, hue] of Object.entries(want)) assert.ok(Math.abs(E.parseColor(name).hue - hue) < 1.5, `${name}: ${E.parseColor(name).hue} vs ${hue}`);
});

test('Tailwind names: a shade is optional (bare = 500), separators and case do not matter, CSS wins for bare names', () => {
  const sky = E.TAILWIND_COLORS.sky;
  for (const typed of ['sky', 'sky-500', 'Sky 500', 'SKY500', 'sky_500', ' sky - 500 ']) assert.equal(E.parseColor(typed).hex, sky[5], typed);
  assert.equal(E.parseColor('sky-50').hex, sky[0]);
  assert.equal(E.parseColor('sky-950').hex, sky[10]);
  assert.equal(E.parseColor('amber').hex, E.TAILWIND_COLORS.amber[5]); // not a CSS name
  // red, green, olive... exist in CSS too: bare means CSS, with a shade means Tailwind
  assert.equal(E.parseColor('red').hex, '#ff0000');
  assert.equal(E.parseColor('red-500').hex, E.TAILWIND_COLORS.red[5]);
  assert.equal(E.parseColor('olive').hex, '#808000');
  assert.equal(E.parseColor('olive-500').hex, E.TAILWIND_COLORS.olive[5]);
  assert.equal(E.parseColor('gray-500').hex, E.TAILWIND_COLORS.gray[5]);
  assert.notEqual(E.parseColor('gray-500').hex, E.CSS_COLORS.gray);
  for (const bad of ['sky-25', 'sky-1000', 'sky-5a', 'skyblue5', 'sky-', '-sky', 'sky_', 'purple-', '_purple', 'red-', 'gold_', 'dark-red-', ' - dark red']) assert.equal(E.parseColor(bad), null, bad);
});

test('color functions: rgb, hsl, hwb and oklch, with commas or spaces, any case, optional alpha', () => {
  const tomato = '#ff6347';
  for (const typed of ['rgb(255, 99, 71)', 'rgb(255 99 71)', 'RGB( 255 , 99 , 71 )', 'rgba(255,99,71,.5)', 'rgb(255 99 71 / 50%)', 'rgb(100% 38.8% 27.8%)', 'rgb(255 99 71 / 0.2)',
    'hsl(9 100% 64%)', 'hsl(9, 100%, 64%)', 'hsla(9, 100%, 64%, 0.3)', 'hsl(9deg 100% 64%)', 'hsl(0.025turn 100% 64%)', 'hsl(10grad 100% 64%)', 'hsl(0.15708rad 100% 64%)', 'hsl(369 100% 64%)', 'hsl(-351 100% 64%)']) {
    assert.equal(E.parseColor(typed).hex, tomato, typed);
    assert.equal(E.parseColor(typed).kind, 'function');
  }
  assert.equal(E.parseColor('rgb(300 -5 0)').hex, '#ff0000');           // clamped, like CSS
  assert.equal(E.parseColor('hwb(0 0% 0%)').hex, '#ff0000');
  assert.equal(E.parseColor('hwb(0 50% 50%)').hex, '#808080');          // w + b >= 1 is a gray
  assert.equal(E.parseColor('hwb(120deg 0% 50%)').hex, '#008000');
  assert.equal(E.parseColor('oklch(70% 0.15 300)').hex, E.parseColor('oklch(0.7 0.15 300deg)').hex);
  assert.equal(E.parseColor('oklch(70% 0.15 300)').hex, E.parseColor('oklch(70% 37.5% 300)').hex); // 100% chroma is 0.4
  assert.equal(E.parseColor('oklch(70% 0.15 300)').hex, E.oklchToHex(0.7, 0.15, 300));
  // out of sRGB: the hue is kept and the chroma is lowered, like every other color on this page
  const wide = E.parseColor('oklch(70% 0.4 150)');
  assert.ok(Math.abs(wide.hue - 150) < 2, String(wide.hue));
  assert.match(wide.hex, /^#[0-9a-f]{6}$/);
});

test('functions that are incomplete, unsupported or not plain numbers are not colors', () => {
  for (const bad of ['rgb(255, 99)', 'rgb(255 99 71 1 1)', 'rgb(a, b, c)', 'rgb(255 99 71', 'rgb 255 99 71', 'rgb(from red r g b)', 'rgb(var(--x))', 'rgb(none 0 0)', 'calc(1)', 'color(srgb 1 0 0)',
    'lab(50% 40 59)', 'lch(50% 40 59)', 'oklab(0.5 0.1 0.1)', 'oklch(70% 0.15)', 'hsl(9%, 100%, 64%)', 'hsl(9 100% 64% / x)', 'hsl(9 red 64%)', 'hwb(0 0%)', 'rgb()', 'rgb(,,)', 'rgb(1 2 3) x',
    'x rgb(1 2 3)', 'rgb(1 2 3)(', 'rgb((1) 2 3)', 'rgb(1e 2 3)', 'rgb(0x10 2 3)']) {
    assert.equal(E.parseColor(bad), null, bad);
  }
});

const isNeutral = (hex) => hex.slice(1, 3) === hex.slice(3, 5) && hex.slice(3, 5) === hex.slice(5, 7);
const NEUTRAL_KEYS = ['editor.background', 'sideBar.background', 'activityBar.background', 'foreground', 'descriptionForeground', 'statusBar.background', 'statusBar.foreground',
  'titleBar.activeBackground', 'titleBar.activeForeground', 'activityBar.foreground', 'button.background', 'button.foreground', 'textLink.foreground', 'focusBorder', 'editor.selectionBackground', 'input.background'];

test('grays written as functions, hex or oklch have no hue, and are still used as the colors they are', () => {
  for (const g of ['rgb(128, 128, 128)', 'hsl(200 0% 50%)', 'hwb(0 50% 50%)', 'oklch(50% 0 0)', 'oklch(100% 0.3 30)', 'oklch(0% 0.3 30)', '#808080', '#808080ff', 'hsl(0 0% 100%)']) {
    const c = E.parseColor(g);
    assert.ok(c, g);
    assert.equal(c.hue, null, g);
    const t = E.buildTheme(g, 'dark');
    assert.deepEqual(t.color, { kind: c.kind, hex: c.hex, neutral: true }, g);
    assert.notEqual(t.hue, (E.hash32(g) / 4294967296) * 360, `${g} is not hashed as text`);
  }
});

test('hexToOklch and oklchToHex round-trip every named color', () => {
  for (const [n, hex] of Object.entries(E.CSS_COLORS)) {
    const k = E.hexToOklch(hex);
    assert.equal(E.oklchToHex(k.L, k.C, k.H), hex, n);
  }
});

test('26 names are grays (too little chroma for a hue); the rest have one', () => {
  assert.equal(GRAYS.length, 26);
  for (const g of ['black', 'white', 'gray', 'grey', 'silver', 'gainsboro', 'dimgray', 'ivory', 'snow']) assert.ok(GRAYS.includes(g), g);
  for (const c of ['red', 'tomato', 'teal', 'gold', 'navy', 'rebeccapurple', 'slategray']) assert.ok(CHROMATIC.includes(c), c);
  assert.equal(E.parseColor('#808080').hue, null);
  assert.equal(E.parseColor('#000').hue, null);
});

test('a color name or hex sets the theme hue to that color\'s hue', () => {
  for (const n of CHROMATIC) {
    const want = E.hexToOklch(E.CSS_COLORS[n]).H;
    for (const mode of ['dark', 'light']) {
      const t = E.buildTheme(n, mode);
      assert.ok(Math.abs(t.hue - want) < 1e-9, `${n} ${mode}: ${t.hue} vs ${want}`);
      assert.deepEqual(t.color, { kind: 'name', hex: E.CSS_COLORS[n], neutral: false });
    }
  }
  assert.deepEqual(E.buildTheme('#f63', 'dark').color, { kind: 'hex', hex: '#ff6633', neutral: false });
});

test('the same color gives the same theme however it is typed', () => {
  for (const mode of MODES) {
    const base = E.buildTheme('tomato', mode);
    for (const typed of ['Tomato', 'TOMATO', '  tomato ', '#ff6347', '#FF6347', '#ff6347cc', 'rgb(255, 99, 71)', 'rgb(255 99 71 / 50%)', 'hsl(9 100% 64%)']) assert.ok(sameTheme(base, E.buildTheme(typed, mode)), `${typed} ${mode}`);
  }
  assert.ok(sameTheme(E.buildTheme('#f63', 'dark'), E.buildTheme('#ff6633', 'dark')));
  assert.ok(sameTheme(E.buildTheme('dark red', 'dark'), E.buildTheme('darkred', 'dark')));
  assert.ok(sameTheme(E.buildTheme('Sky 500', 'light'), E.buildTheme('sky', 'light')));
  assert.ok(sameTheme(E.buildTheme('sky-500', 'light'), E.buildTheme(E.TAILWIND_COLORS.sky[5], 'light'))); // a Tailwind shade is its hex
  // aqua and cyan, gray and grey, fuchsia and magenta are the same color under two names
  assert.ok(sameTheme(E.buildTheme('aqua', 'dark'), E.buildTheme('cyan', 'dark')));
  assert.ok(sameTheme(E.buildTheme('fuchsia', 'light'), E.buildTheme('magenta', 'light')));
});

test('different colors give different themes', () => {
  assert.notEqual(E.buildTheme('tomato', 'dark').colors['titleBar.activeBackground'], E.buildTheme('teal', 'dark').colors['titleBar.activeBackground']);
});

test('grays, white and black give a neutral theme: no tint anywhere in the surfaces, text or bars, and no hashing of the typed text', () => {
  for (const n of GRAYS.concat(['#808080', '#000', '#fff', 'rgb(10 20 30)', 'oklch(70% 0.02 200)'])) {
    for (const mode of ['dark', 'light']) {
      const t = E.buildTheme(n, mode);
      assert.deepEqual(t.color, { kind: E.parseColor(n).kind, hex: E.parseColor(n).hex, neutral: true }, n);
      assert.equal(t.hue, 250, `${n} syntax starts from the neutral base hue`);
      for (const k of NEUTRAL_KEYS) assert.ok(isNeutral(t.colors[k]), `${n} ${mode} ${k} ${t.colors[k]}`);
      assert.ok(isNeutral(t.palette.sbBg) && isNeutral(t.palette.sbFg) && isNeutral(t.palette.sbHover), n);
    }
  }
  // the syntax colors are still colors (a monochrome editor would be unreadable and fail the color-blind separation)
  const syn = E.buildTheme('gray', 'dark');
  assert.ok(syn.tok && Object.values(syn.tok).every((h) => !isNeutral(h)), 'syntax stays chromatic');
});

test('the same gray is the same theme however it is typed, and different grays are different themes', () => {
  const a = E.buildTheme('gray', 'dark');
  for (const t of ['Gray', 'GREY', ' grey ', '#808080', '#888', 'rgb(128 128 128)', 'hsl(0 0% 50.2%)']) {
    if (t === '#888') continue; // #888 is #888888, a different gray
    assert.ok(sameTheme(a, E.buildTheme(t, 'dark')), t);
  }
  const bars = new Set(['black', 'dimgray', 'gray', 'silver', 'gainsboro', 'white'].map((n) => E.buildTheme(n, 'dark').palette.sbBg));
  assert.ok(bars.size >= 5, 'black, white and the grays between them do not all give the same bar');
});

test('ordinary names are untouched: no color info, hue straight from the hash', () => {
  for (const n of ['food', 'tidepool', 'my-project', 'Hello World', '', '🚀']) {
    const t = E.buildTheme(n, 'dark');
    assert.equal(t.color, null);
    assert.equal(t.hue, (E.hash32(n.toLowerCase()) / 4294967296) * 360);
  }
});

test('every named color, every Tailwind shade, and a sweep of hex colors, passes every contrast target in dark and light', () => {
  const seeds = NAMES.slice();
  for (const [fam, shades] of Object.entries(E.TAILWIND_COLORS)) shades.forEach((_, i) => seeds.push(`${fam}-${E.TAILWIND_SHADES[i]}`));
  for (let h = 0; h < 360; h += 3) for (const [L, C] of [[0.9, 0.2], [0.65, 0.15], [0.3, 0.08], [0.55, 0.035]]) seeds.push(E.oklchToHex(L, C, h));
  for (let L = 0; L <= 1.0001; L += 0.02) for (const C of [0, 0.01, 0.025]) seeds.push(E.oklchToHex(L, C, 40)); // every gray, and near-grays
  const failures = [];
  for (const seed of seeds) for (const mode of ['dark', 'light']) {
    for (const c of E.buildTheme(seed, mode).checks) if (!c.pass) failures.push(`${seed} | ${mode} | ${c.label}`);
  }
  assert.ok(seeds.length > 900);
  assert.deepEqual(failures.slice(0, 10), []);
});

test('the title bar, activity bar and status bar are identical in dark and light for every named color and Tailwind shade', () => {
  const tw = Object.entries(E.TAILWIND_COLORS).flatMap(([f, sh]) => sh.map((_, i) => `${f}-${E.TAILWIND_SHADES[i]}`));
  for (const n of NAMES.concat(tw)) {
    const d = E.buildTheme(n, 'dark'), l = E.buildTheme(n, 'light');
    for (const k of E.FRAME_KEYS) assert.equal(d.colors[k], l.colors[k], `${n} ${k}`);
  }
});

test('a light color keeps a bright bar with dark text; a dark color keeps a dark bar with light text', () => {
  const lum = (hex) => E.hexToOklch(hex).L;
  for (const [n, bright] of [['yellow', true], ['gold', true], ['tomato', true], ['aqua', true], ['sky-300', true], ['pink', true], ['teal', false], ['navy', false], ['sky-700', false], ['rebeccapurple', false]]) {
    for (const mode of ['dark', 'light']) {
      const t = E.buildTheme(n, mode);
      assert.equal(t.brightBar, bright, `${n} ${mode}`);
      const bar = t.colors['statusBar.background'];
      const fg = t.colors['statusBar.foreground'];
      assert.equal(lum(fg) > lum(bar), !bright, `${n}: text is ${bright ? 'darker' : 'lighter'} than the bar`);
      assert.ok(E.contrast(fg, bar) >= 4.5, `${n} ${mode} bar text ${E.contrast(fg, bar).toFixed(2)}`);
    }
  }
  // yellow is actually yellow now, not olive
  const y = E.hexToOklch(E.buildTheme('yellow', 'dark').colors['statusBar.background']);
  assert.ok(y.L > 0.85 && y.C > 0.15, `yellow bar L ${y.L.toFixed(2)} C ${y.C.toFixed(2)}`);
});

test('every frame foreground follows the bar: dark text on a bright bar, in every frame key, hover and pressed included', () => {
  for (const n of ['yellow', 'gold', 'lime', 'sky-200', 'amber-300', '#ffeb3b', 'hsl(50 100% 60%)']) {
    const t = E.buildTheme(n, 'dark');
    assert.ok(t.brightBar, n);
    const fg = t.palette.sbFg;
    for (const k of ['titleBar.activeForeground', 'activityBar.foreground', 'activityBar.activeBorder', 'statusBar.foreground', 'statusBar.noFolderForeground', 'statusBarItem.hoverForeground', 'modernActivityBarItem.hoverForeground']) {
      assert.equal(t.colors[k], fg, `${n} ${k}`);
    }
    assert.equal(t.colors['activityBarBadge.background'], fg);
    assert.equal(t.colors['activityBarBadge.foreground'], t.colors['statusBar.background']);
    // hover and pressed stay visible against the bar and keep 4.5:1 text
    for (const bg of [t.palette.sbHover, t.palette.sbActive]) assert.ok(E.contrast(fg, bg) >= 4.5, `${n} hover ${bg}`);
    assert.ok(E.contrast(t.palette.sbHover, t.palette.sbBg) >= 1.15, `${n} hover visible`);
    // buttons and badges are not frame keys and keep their light text
    assert.ok(E.hexToOklch(t.colors['button.foreground']).L > 0.9, `${n} button text stays light`);
  }
});

test('a typed color, gray or not, gets a bright bar exactly when it is light (L >= 0.6)', () => {
  for (const n of Object.keys(E.CSS_COLORS)) {
    const c = E.parseColor(n);
    assert.equal(E.buildTheme(n, 'dark').brightBar, c.lightness >= 0.6, n);
    // below the cutoff, light text on the color itself is still readable
    if (c.lightness < 0.6) assert.ok(E.contrast('#fafafa', c.hex) >= 3.5, `${n} is dark enough for light text`);
  }
  for (const [n, bright] of [['white', true], ['silver', true], ['whitesmoke', true], ['gray', false], ['dimgray', false], ['black', false]]) {
    assert.equal(E.buildTheme(n, 'dark').brightBar, bright, n);
  }
});

test('a bright bar is the typed color (same hue, close lightness), up to the lightness cap', () => {
  for (const n of ['gold', 'tomato', 'skyblue', 'orange', 'hotpink', 'sky-300', 'lime']) {
    const c = E.parseColor(n);
    const bar = E.hexToOklch(E.buildTheme(n, 'dark').colors['statusBar.background']);
    assert.ok(Math.abs(bar.L - Math.min(c.lightness, 0.93)) < 0.03, `${n} L ${bar.L.toFixed(2)} vs ${c.lightness.toFixed(2)}`);
    let dh = Math.abs(bar.H - c.hue); if (dh > 180) dh = 360 - dh;
    assert.ok(dh < 6, `${n} hue ${bar.H.toFixed(0)} vs ${c.hue.toFixed(0)}`);
  }
});
