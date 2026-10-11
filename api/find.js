module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const queryUrl = req.query?.url || new URL(req.url, 'http://localhost').searchParams.get('url');
  if (!queryUrl) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: false, error: 'Parameter url diperlukan.' }));
  }

  const targetUrl = `https://amfinder.web.id/api/find?url=${encodeURIComponent(queryUrl)}`;

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
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: false, error: 'Gagal menghubungi upstream: ' + err.message }));
  }
};
