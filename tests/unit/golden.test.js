'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compute, GOLDEN_SEEDS } = require('../helpers/golden.js');

const file = path.join(__dirname, '..', 'fixtures', 'golden.json');

test('output matches the golden snapshot (the same name must keep the same colors)', () => {
  const expected = JSON.parse(fs.readFileSync(file, 'utf8'));
  const actual = compute();
  assert.equal(Object.keys(expected).length, GOLDEN_SEEDS.length, 'golden.json covers the current name list; run `pnpm golden:update`');
  const changed = Object.keys(expected).filter((name) => JSON.stringify(expected[name]) !== JSON.stringify(actual[name]));
  assert.deepEqual(
    changed,
    [],
    'These names now produce different colors, which would recolor existing windows. ' +
      'If that is intended, run `pnpm golden:update`, review the diff and say so in the PR.'
  );
});
