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
