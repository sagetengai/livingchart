// server.js — Tengai dev server
// Serves src/ as web root; routes /config/ and /data/ from the project root.
const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = 8080;
const ROOT = __dirname;

const MIME = {
  '.html':    'text/html',
  '.css':     'text/css',
  '.js':      'application/javascript',
  '.json':    'application/json',
  '.png':     'image/png',
  '.webp':    'image/webp',
  '.svg':     'image/svg+xml',
  '.geojson': 'application/geo+json',
  '.ico':     'image/x-icon',
};

function resolve(urlPath) {
  urlPath = urlPath.split('?')[0];
  if (urlPath === '/')                  return path.join(ROOT, 'src', 'index.html');
  if (urlPath.startsWith('/config/') ||
      urlPath.startsWith('/data/')   ||
      urlPath.startsWith('/docs/'))     return path.join(ROOT, urlPath);
  return path.join(ROOT, 'src', urlPath);
}

http.createServer((req, res) => {
  const filePath    = resolve(req.url);
  const ext         = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      const code = err.code === 'ENOENT' ? 404 : 500;
      res.writeHead(code, { 'Content-Type': 'text/plain' });
      res.end(code + ' ' + req.url);
      console.log('[' + err.code + '] ' + req.url);
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
    console.log('[200] ' + req.url);
  });
}).listen(PORT, () => {
  console.log('Tengai dev server → http://localhost:' + PORT);
});
