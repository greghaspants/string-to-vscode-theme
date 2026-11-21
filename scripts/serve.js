'use strict';
/* Minimal static server for dist/, used by Playwright (see playwright.config.js) and `pnpm serve`. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'dist', 'index.html');
const port = Number(process.env.PORT || 4173);

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname !== '/' && pathname !== '/index.html') {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('dist/index.html is missing. Run `pnpm build` first.');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(buf);
  });
});

server.listen(port, '127.0.0.1', () => console.log(`Serving dist/ at http://127.0.0.1:${port}/`));
