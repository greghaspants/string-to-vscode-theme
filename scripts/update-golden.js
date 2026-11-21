'use strict';
/* Rewrites tests/fixtures/golden.json from the current engine. Read tests/helpers/golden.js before using it. */
const fs = require('node:fs');
const path = require('node:path');
const { compute } = require('../tests/helpers/golden.js');

const file = path.join(__dirname, '..', 'tests', 'fixtures', 'golden.json');
const next = compute();
fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
console.log(`wrote ${path.relative(process.cwd(), file)} (${Object.keys(next).length} names)`);
console.log('Review the diff: every changed line is a color that will change in people\'s windows.');
