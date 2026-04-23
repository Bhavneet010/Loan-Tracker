const http = require('http');
const fs = require('fs');
const path = require('path');

const host = '127.0.0.1';
const port = Number(process.env.PORT || 4175);
const root = __dirname;

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

http.createServer((req, res) => {
  const rawPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const relativePath = rawPath === '/' ? 'index.html' : rawPath.replace(/^\/+/, '');
  const fullPath = path.resolve(root, relativePath);

  if (!fullPath.startsWith(path.resolve(root))) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': mime[path.extname(fullPath).toLowerCase()] || 'application/octet-stream'
    });
    res.end(data);
  });
}).listen(port, host, () => {
  console.log(`Serving ${root} at http://${host}:${port}`);
});
