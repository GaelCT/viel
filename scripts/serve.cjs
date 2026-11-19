'use strict';

// Local browser-test server. Serve only the app's public static file types.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (relative.includes('\\') || relative.split('/').some(p => p.startsWith('.')) || relative.includes('/')) {
      res.writeHead(404).end();
      return;
    }
    const type = types[path.extname(relative)];
    if (!type) { res.writeHead(404).end(); return; }
    const content = await fs.readFile(path.join(root, relative));
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(content);
  } catch {
    res.writeHead(404).end();
  }
});
server.listen(4178, '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
