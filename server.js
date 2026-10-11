// Native Node.js server - serves static files & proxies /api/find to avoid CORS
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const UPSTREAM = 'https://amfinder.web.id';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // CORS headers for all incoming requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // Proxy endpoint
  if (reqUrl.pathname === '/api/find') {
    const targetUrl = `${UPSTREAM}/api/find${reqUrl.search}`;
    try {
      const upstreamRes = await fetch(targetUrl, {
        method: 'GET',
        headers: {
          'Accept': 'text/event-stream, application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; AnkraiXMotion/1.0)'
        }
      });

      res.writeHead(upstreamRes.status, {
        'Content-Type': upstreamRes.headers.get('content-type') || 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive'
      });

      if (!upstreamRes.body) return res.end();

      const reader = upstreamRes.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      return res.end();
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'Gagal menghubungi upstream: ' + err.message }));
    }
  }

  // Static file serving
  let filePath = path.join(ROOT, reqUrl.pathname === '/' ? 'index.html' : reqUrl.pathname);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not Found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`Server aktif di http://localhost:${PORT}`);
});
