'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../../src/engine.js');
const { shuffleWords } = require('../helpers/words.js');

const WORDS = shuffleWords();

test('the random-word list is clean: unique, trimmed, lowercase letters and single spaces', () => {
  assert.ok(WORDS.length >= 40);
  assert.equal(new Set(WORDS).size, WORDS.length, 'duplicate words');
  for (const w of WORDS) assert.match(w, /^[a-z]+( [a-z]+)*$/, `"${w}"`);
  assert.ok(!WORDS.includes('food'), 'the starting name would make the first shuffle a no-op');
});

test('no random word is a CSS color name or hex, or it would take that color\'s hue instead of a hashed one', () => {
  for (const w of WORDS) assert.equal(E.parseColor(w), null, w);
});

test('the coffee words are in the list', () => {
  for (const w of ['coffee', 'cold brew', 'latte', 'espresso', 'mocha']) assert.ok(WORDS.includes(w), w);
});

test('every random word passes every contrast target, light and dark', () => {
  const failures = [];
  for (const w of WORDS) for (const mode of ['dark', 'light']) {
    for (const c of E.buildTheme(w, mode).checks) if (!c.pass) failures.push(`${w} | ${mode} | ${c.label}`);
  }
  assert.deepEqual(failures, []);
});

test('every random word survives the URL round trip, including the ones with a space', () => {
  for (const w of WORDS) {
    const hash = E.UrlState.encode(Object.assign({}, E.UrlState.DEFAULTS, { seed: w }));
    assert.equal(E.UrlState.parse('#' + hash).seed, w, w);
  }
});

test('the list has plenty of words that give a bright bar with dark text, from pastel to vivid', () => {
  const bright = WORDS.filter((w) => E.buildTheme(w, 'dark').brightBar);
  assert.ok(bright.length >= 12, `only ${bright.length} bright words`);
  const ls = bright.map((w) => E.hexToOklch(E.buildTheme(w, 'dark').palette.sbBg).L).sort((a, b) => a - b);
  assert.ok(ls[0] < 0.72, 'some are vivid (a lower lightness)');
  assert.ok(ls[ls.length - 1] > 0.84, 'some are pastel (a higher lightness)');
  for (const w of ['alpha', 'cherry', 'acme', 'forest', 'apple', 'sunrise', 'garden']) assert.ok(WORDS.includes(w), w);
});
