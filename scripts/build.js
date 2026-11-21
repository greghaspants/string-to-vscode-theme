'use strict';
/*
 * Builds dist/index.html: src/template.html with src/engine.js inlined, the default theme's CSS
 * variables injected (so the first paint is already themed) and a build id in <meta name="build">.
 * The output is one self-contained file with no external requests.
 *
 *   pnpm build                 -> build id "dev"
 *   BUILD_ID=<sha> pnpm build  -> what CI does, so the live page can be matched to a commit
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

const engineSrc = read('src', 'engine.js');
const E = require('../src/engine.js');
const theme = E.buildTheme('food', 'auto'); // the page's default seed
const rootVars = Object.entries(E.cssVars(theme)).map(([k, v]) => `  ${k}: ${v};`).join('\n');

// The Node-only export line at the end of engine.js is not needed in the browser.
const inlineEngine = engineSrc.replace(/\nif \(typeof module[\s\S]*$/, '\n');

let html = read('src', 'template.html');
const buildId = (process.env.BUILD_ID || 'dev').trim();
if (!/^[A-Za-z0-9._-]+$/.test(buildId)) throw new Error(`BUILD_ID has unexpected characters: ${buildId}`);

// Function replacers: a string replacement would treat "$&", "$'" etc. in the engine source specially.
const inject = (token, value) => {
  if (html.split(token).length !== 2) throw new Error(`template must contain ${token} exactly once`);
  html = html.replace(token, () => value);
};
inject('__BUILD_ID__', buildId);
inject('/*ROOT_VARS*/', rootVars);
inject('<!--ENGINE-->', '<script>\n' + inlineEngine + '</script>');

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'index.html'), html);
console.log(`built dist/index.html: ${(Buffer.byteLength(html) / 1024).toFixed(1)} KB, build id ${buildId}`);
