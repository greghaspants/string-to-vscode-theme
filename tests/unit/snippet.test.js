'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../../src/engine.js');
const { words } = require('../helpers/words.js');

const HEX = /^#[0-9a-f]{6}$/;
const SEEDS = ['food', 'foods', '', 'Hello World', 'ñandú', '🚀'].concat(words(8));
const FRAME = new Set(E.FRAME_KEYS);
const TOP_LEVEL = /^(workbench\.colorTheme|workbench\.colorCustomizations|editor\.tokenColorCustomizations|editor\.semanticTokenColorCustomizations)$/;
const bools = [false, true];

function parse(snippet, braces) {
  return JSON.parse(braces ? snippet : '{' + snippet.replace(/,\s*$/, '') + '}');
}

/** The non-frame color keys a given option set should produce. */
function expectedKeys(t, o) {
  if (o.everything) return Object.keys(t.colors).filter((k) => !FRAME.has(k));
  const keys = [].concat(o.explorer ? E.EXPLORER_KEYS : [], o.editor ? E.EDITOR_KEYS : [], o.panel ? E.PANEL_KEYS : []);
  return [...new Set(keys)];
}

test('without light/dark matching, each option adds exactly its own keys', () => {
  for (const seed of SEEDS) for (const mode of ['dark', 'light']) {
    const t = E.buildTheme(seed, mode);
    for (const explorer of bools) for (const editor of bools) for (const panel of bools) for (const everything of bools) for (const braces of bools) {
      const o = { explorer, editor, panel, everything, braces };
      const json = parse(E.makeSnippet(t, o), braces);
      const c = json['workbench.colorCustomizations'];
      const label = JSON.stringify(o);
      const want = new Set(E.FRAME_KEYS.concat(expectedKeys(t, o)));
      assert.deepEqual(new Set(Object.keys(c)), want, label);
      for (const [k, v] of Object.entries(c)) assert.equal(v, t.colors[k], `${label} ${k}`);
      assert.ok(E.FRAME_KEYS.every((k) => k in c), `frame always present ${label}`);
      assert.equal('workbench.colorTheme' in json, everything, `base theme only with everything ${label}`);
      assert.equal('editor.tokenColorCustomizations' in json, editor || everything, `token rules ${label}`);
      if (!everything) {
        assert.equal('sideBar.background' in c, explorer, `side bar leak ${label}`);
        assert.equal('editor.background' in c, editor, `editor leak ${label}`);
        assert.equal('panel.background' in c, panel, `panel leak ${label}`);
        assert.equal('terminal.ansiRed' in c, panel, `terminal leak ${label}`);
      }
    }
  }
});

test('the base theme and semantic-token switches', () => {
  const t = E.buildTheme('food', 'dark');
  const full = JSON.parse(E.makeSnippet(t, { everything: true, braces: true }));
  assert.equal(full['workbench.colorTheme'], 'Default Dark Modern');
  assert.ok(full['editor.semanticTokenColorCustomizations']);
  const noBase = JSON.parse(E.makeSnippet(t, { everything: true, baseTheme: false, braces: true }));
  assert.equal('workbench.colorTheme' in noBase, false);
  const noSem = JSON.parse(E.makeSnippet(t, { editor: true, semantic: false, braces: true }));
  assert.equal('editor.semanticTokenColorCustomizations' in noSem, false);
  assert.equal(JSON.parse(E.makeSnippet(E.buildTheme('food', 'light'), { everything: true, braces: true }))['workbench.colorTheme'], 'Default Light Modern');
});

test('the default snippet is the frame plus the side bars', () => {
  const t = E.buildTheme('food', 'dark');
  const c = parse(E.makeSnippet(t, {}), false)['workbench.colorCustomizations'];
  assert.equal(Object.keys(c).length, E.FRAME_KEYS.length + E.EXPLORER_KEYS.length);
});

test('a fragment (no braces) is ready to paste inside an existing settings.json', () => {
  const s = E.makeSnippet(E.buildTheme('food', 'dark'), {});
  assert.ok(s.startsWith('"workbench.colorCustomizations": {'));
  assert.ok(s.endsWith('},'));
  assert.doesNotThrow(() => parse(s, false));
  assert.ok(E.makeSnippet(E.buildTheme('food', 'dark'), { braces: true }).startsWith('{\n'));
});

test('with light/dark matching: frame unscoped, everything else in [*Dark*] and [*Light*]', () => {
  const sample = SEEDS.slice(0, 4);
  for (const seed of sample) {
    const d = E.buildTheme(seed, 'dark'), l = E.buildTheme(seed, 'light');
    for (const mode of ['auto', 'dark', 'light']) {
      const t = E.buildTheme(seed, mode);
      for (let i = 0; i < 128; i++) {
        const o = { adapt: true, explorer: !!(i & 1), editor: !!(i & 2), panel: !!(i & 4), everything: !!(i & 8), semantic: !!(i & 16), baseTheme: !!(i & 32), braces: true };
        const label = `${seed}/${mode} ${JSON.stringify(o)}`;
        const snip = E.makeSnippet(t, o);
        const json = JSON.parse(snip);
        const c = json['workbench.colorCustomizations'];

        assert.equal('workbench.colorTheme' in json, false, `no base theme while matching ${label}`);
        for (const k of Object.keys(json)) assert.match(k, TOP_LEVEL, label);
        for (const k of E.FRAME_KEYS) assert.equal(c[k], d.colors[k], `frame ${k} ${label}`); // same in both versions

        const want = expectedKeys(t, o);
        const scopes = Object.keys(c).filter((k) => k[0] === '[');
        assert.deepEqual(scopes, want.length ? [E.SCOPE_DARK, E.SCOPE_LIGHT] : [], label);
        for (const k of Object.keys(c)) if (k[0] !== '[') assert.ok(FRAME.has(k), `only the frame is unscoped: ${k} ${label}`);
        for (const sc of scopes) {
          const blk = c[sc], src = sc === E.SCOPE_DARK ? d : l;
          assert.deepEqual(new Set(Object.keys(blk)), new Set(want), `${sc} keys ${label}`);
          for (const [k, v] of Object.entries(blk)) { assert.match(v, HEX); assert.equal(v, src.colors[k], `${sc} ${k} ${label}`); }
        }

        const tk = json['editor.tokenColorCustomizations'], sm = json['editor.semanticTokenColorCustomizations'];
        if (o.editor || o.everything) {
          assert.deepEqual(tk[E.SCOPE_DARK].textMateRules, d.textMateRules, label);
          assert.deepEqual(tk[E.SCOPE_LIGHT].textMateRules, l.textMateRules, label);
          if (o.semantic) {
            assert.deepEqual(sm[E.SCOPE_DARK].rules, d.semanticRules, label);
            assert.deepEqual(sm[E.SCOPE_LIGHT].rules, l.semanticRules, label);
          } else assert.equal(sm, undefined, label);
        } else assert.ok(!tk && !sm, `no token settings without the coding palette ${label}`);

        // The snippet never depends on which version the preview happens to show.
        const other = E.buildTheme(seed, t.dark ? 'light' : 'dark');
        assert.equal(E.makeSnippet(other, o), snip, `preview mode independence ${label}`);
      }
    }
  }
});

test('the matching snippet stays small by default and grows only with the areas you pick', () => {
  const t = E.buildTheme('food', 'auto');
  const size = (o) => E.makeSnippet(t, Object.assign({ adapt: true }, o)).length;
  assert.ok(size({}) < 4000);
  assert.ok(size({ panel: true }) > size({}));
  assert.ok(size({ editor: true, panel: true }) > size({ editor: true }));
  assert.ok(size({ everything: true }) >= size({ explorer: true, editor: true, panel: true }));
});
