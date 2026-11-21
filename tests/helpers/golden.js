'use strict';
/*
 * Golden snapshot of the theme engine's output.
 *
 * The promise of this project is "the same name always gives the same colors, on every machine, forever".
 * tests/fixtures/golden.json pins that down: for a fixed list of names it stores a SHA-256 of everything the
 * engine generates (all hex colors, token rules, and three snippet variants) plus a few readable colors so a
 * diff shows what moved. If a code change alters any of it, tests/unit/golden.test.js fails.
 *
 * Changing the output changes the color of every window people already use. Only do it on purpose, then run
 *   pnpm golden:update
 * and describe the change in the PR.
 */
const crypto = require('node:crypto');
const E = require('../../src/engine.js');
const { words } = require('./words.js');

const GOLDEN_SEEDS = ['food', 'foods', '', 'Hello World', 'ñandú', '🚀', 'tidepool', 'ember', 'quarry', 'lantern', 'basalt', 'marigold']
  .concat(words(28));

const sha = (value) => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex').slice(0, 20);

function compute() {
  const out = {};
  for (const seed of GOLDEN_SEEDS) {
    const entry = {};
    for (const mode of ['dark', 'light']) {
      const t = E.buildTheme(seed, mode);
      entry[mode] = {
        titleBar: t.colors['titleBar.activeBackground'],
        editorBg: t.colors['editor.background'],
        keyword: t.tok.keyword,
        theme: sha({ colors: t.colors, textMateRules: t.textMateRules, semanticRules: t.semanticRules })
      };
    }
    const auto = E.buildTheme(seed, 'auto');
    entry.auto = auto.dark ? 'dark' : 'light';
    entry.snippets = {
      default: sha(E.makeSnippet(auto, { adapt: true, braces: true })),
      allAreas: sha(E.makeSnippet(auto, { adapt: true, explorer: true, editor: true, panel: true, braces: true })),
      everythingNoAdapt: sha(E.makeSnippet(auto, { adapt: false, everything: true, braces: true }))
    };
    out[seed === '' ? '(empty)' : seed] = entry;
  }
  return out;
}

module.exports = { GOLDEN_SEEDS, compute };
