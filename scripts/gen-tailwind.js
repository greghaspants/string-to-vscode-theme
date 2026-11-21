'use strict';
/*
 * Prints the Tailwind CSS palette table that lives in src/engine.js (TAILWIND_SRC), so it can be refreshed.
 *
 *   mkdir /tmp/tw && cd /tmp/tw && npm pack tailwindcss && tar xzf tailwindcss-*.tgz
 *   node scripts/gen-tailwind.js /tmp/tw/package/theme.css
 *
 * Tailwind v4 defines its colors in OKLCH. Each is converted to sRGB hex with the engine's own gamut mapping
 * (chroma is lowered at fixed lightness and hue), so the hue the page uses is Tailwind's hue. Paste the output
 * over the TAILWIND_SRC lines in src/engine.js, then run `pnpm golden:update` only if you mean to recolor
 * existing names (a changed shade recolors every window named after it).
 */
const fs = require('node:fs');
const E = require('../src/engine.js');

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/gen-tailwind.js <path to tailwindcss/theme.css>'); process.exit(1); }
const css = fs.readFileSync(file, 'utf8');
const re = /--color-([a-z]+)-(\d+):\s*oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+|none)\s*\)/g;
const families = new Map();
let m;
while ((m = re.exec(css))) {
  const [, fam, shade, L, C, H] = m;
  if (!families.has(fam)) families.set(fam, new Map());
  families.get(fam).set(Number(shade), E.oklchToHex(parseFloat(L) / 100, parseFloat(C), H === 'none' ? 0 : parseFloat(H)));
}
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const lines = [];
for (const [fam, shades] of families) {
  if (SHADES.some((s) => !shades.has(s))) throw new Error(`${fam} is missing a shade`);
  lines.push(`    ${fam}: '${SHADES.map((s) => shades.get(s)).join(' ')}',`);
}
const version = (/"version":\s*"([^"]+)"/.exec(fs.readFileSync(require('node:path').join(require('node:path').dirname(file), 'package.json'), 'utf8')) || [])[1];
console.log(`// tailwindcss ${version || '?'}: ${families.size} families x ${SHADES.length} shades (50 100 200 300 400 500 600 700 800 900 950)`);
console.log(lines.join('\n'));
