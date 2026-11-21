'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../../src/engine.js');
const { words } = require('../helpers/words.js');

const U = E.UrlState;
const RESERVED = ['settings', 'sidebar', 'customize', 'upgrade', 'downloads'];
const trimmed = (st) => Object.assign({}, st, { seed: st.seed.trim() });

test('defaults encode to an empty fragment', () => {
  assert.equal(U.encode(U.DEFAULTS), '');
  assert.deepEqual(U.parse(''), U.DEFAULTS);
  assert.deepEqual(U.parse('#'), U.DEFAULTS);
});

test('only non-default inputs are written, in a readable form', () => {
  assert.equal(U.encode({ ...U.DEFAULTS, seed: 'my-project' }), 'my-project');
  assert.equal(U.encode({ ...U.DEFAULTS, seed: 'tidepool' }), 'tidepool');
  assert.equal(U.encode({ ...U.DEFAULTS, mode: 'dark', editor: true }), '--dark--editor');
  assert.equal(U.encode({ ...U.DEFAULTS, panel: true }), '--panel');
  assert.equal(U.encode({ ...U.DEFAULTS, explorer: false }), '--no-explorer');
  assert.equal(U.encode({ ...U.DEFAULTS, adapt: false }), '--no-adapt');
  assert.equal(U.encode({ ...U.DEFAULTS, seed: 'tidepool', editor: true, panel: true, every: true }), 'tidepool--editor--panel--everything');
  assert.equal(U.encode({ ...U.DEFAULTS, seed: '', braces: true }), '--blank--braces');
});

test('seeds that cannot be written plainly are base32-encoded', () => {
  for (const seed of ['My Project', 'MyProject', 'my_project', 'ñandú', '🚀 launch', '日本語のプロジェクト', 'a--b']) {
    const h = U.encode({ ...U.DEFAULTS, seed });
    assert.match(h, /^--s-[a-z2-7]+$/, seed);
    assert.equal(U.parse('#' + h).seed, seed);
  }
});

test('names claude.ai reserves are never written bare', () => {
  for (const seed of RESERVED.concat(['comment-12', 'comment-'])) {
    const h = U.encode({ ...U.DEFAULTS, seed });
    assert.ok(!RESERVED.includes(h) && !h.startsWith('comment-'), `${seed} -> ${h}`);
    assert.equal(U.parse('#' + h).seed, seed);
  }
});

test('2,000 random states round-trip, stay URL-safe, and re-encode to the same link', () => {
  let s = 99;
  const r = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  const pick = (a) => a[Math.floor(r() * a.length)];
  const fixed = ['food', 'foods', '', ' ', '  food  ', 'My Project', 'a.b', '@scope/pkg', 'settings', 'comment-12', 'a--b', '-a', 'a-', 'dark', 'editor', 'panel', 'blank', 's-abc', 'x'.repeat(200), 'é'.repeat(200)];
  for (let i = 0; i < 2000; i++) {
    const st = {
      seed: i < fixed.length ? fixed[i] : words(1, i + 1)[0] + (r() < 0.3 ? ' ' + words(1, i + 7)[0] : '') + (r() < 0.2 ? '-' + words(1, i + 3)[0] : ''),
      mode: pick(['auto', 'dark', 'light']), vision: pick(['normal', 'protan', 'deutan', 'tritan', 'gray']),
      explorer: r() < 0.5, editor: r() < 0.5, panel: r() < 0.5, every: r() < 0.5, adapt: r() < 0.5, base: r() < 0.5, sem: r() < 0.5, braces: r() < 0.5
    };
    const h = U.encode(st);
    assert.match(h, /^[A-Za-z0-9-]*$/, 'only characters the artifact host passes through');
    assert.ok(h.length <= 1200, `too long: ${h.length}`);
    assert.deepEqual(U.parse('#' + h), trimmed(st), JSON.stringify(st));
    assert.equal(U.encode(U.parse('#' + h)), h);
  }
});

test('hand-typed and damaged links fall back to defaults instead of throwing', () => {
  assert.deepEqual([U.parse('#Quarry--light').seed, U.parse('#Quarry--light').mode], ['Quarry', 'light']);
  assert.deepEqual([U.parse('#--unknown--dark').seed, U.parse('#--unknown--dark').mode], ['food', 'dark']);
  assert.equal(U.parse('#--s-!!!').seed, 'food');
  assert.equal(U.parse('#--panel--editor').panel, true);
  assert.equal(U.parse('#--editor').panel, false);
  assert.doesNotThrow(() => U.parse('#%E0%A4%A'));
});
