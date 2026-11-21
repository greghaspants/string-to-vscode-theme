'use strict';
/* Deterministic pseudo-random lowercase "words" (a small LCG), so every run and every machine tests the same names. */
function words(n, seed = 12345) {
  const out = [];
  const a = 'abcdefghijklmnopqrstuvwxyz';
  let s = seed;
  const r = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < n; i++) {
    const len = 1 + Math.floor(r() * 12);
    let w = '';
    for (let j = 0; j < len; j++) w += a[Math.floor(r() * 26)];
    out.push(w);
  }
  return out;
}

/* The names the "Try a random word" button can pick, read straight from the page source so the tests cannot drift from it. */
function shuffleWords() {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../src/template.html'), 'utf8');
  const m = /var WORDS = (\[[^\]]*\]);/.exec(src);
  if (!m) throw new Error('WORDS list not found in src/template.html');
  return JSON.parse(m[1].replace(/'/g, '"'));
}

module.exports = { words, shuffleWords };
