/**
 * AM Preset Finder Scraper (Proxy Edition 2)
 * Menggunakan library "impers" dan Webshare Proxy (IP Baris 2)
 */

const { fetch } = require('impers'); 

const BASE_URL = 'https://amfinder.web.id';
// Alamat proxy dari Webshare (baris kedua)
const PROXY_URL = 'http://bwjzartd:3bva829f5zgj@64.137.96.74:6641';

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
  'Referer': 'https://www.tiktok.com/',
};

function isValidTikTokUrl(url) {
  const trimmed = (url || '').trim();
  return /tiktok\.com/i.test(trimmed) || /^\d{15,}$/.test(trimmed);
}

async function parseSSEStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = null;
  let dataLines = [];

  const dispatchEvent = () => {
    if (!currentEvent && dataLines.length === 0) return null;
    const dataStr = dataLines.join('\n').trim();
    const evt = currentEvent;
    currentEvent = null;
    dataLines = [];

    if (evt === 'result' && dataStr) {
      try { return JSON.parse(dataStr); } catch { throw new Error('Unreadable response from server'); }
    }
    if (evt === 'error' && dataStr) {
      try {
        const err = JSON.parse(dataStr);
        throw new Error(err.message || 'Something went wrong');
      } catch (e) {
        if (e instanceof SyntaxError) throw new Error('Something went wrong, try again');
        throw e;
      }
    }
    return null;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (!line) {
        const res = dispatchEvent();
        if (res) return res;
        continue;
      }
      if (line.startsWith('event:')) currentEvent = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
  }
  if (buffer.trim()) {
    const line = buffer.trim();
    if (line.startsWith('event:')) currentEvent = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  const finalRes = dispatchEvent();
  if (finalRes) return finalRes;
  throw new Error('Connection closed before it finished, try again');
}

async function get_preset_links(link_tiktok) {
  const url = (link_tiktok || '').trim();

  if (!url) throw new Error('TikTok video link is required');
  if (!isValidTikTokUrl(url)) throw new Error('That link is not from TikTok. Paste a TikTok video link first.');

  const apiUrl = `${BASE_URL}/api/find?url=${encodeURIComponent(url)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    // REQUEST MENGGUNAKAN IMPERS + PROXY
    const response = await fetch(apiUrl, {
      method: 'GET',
      impersonate: 'chrome124',
      proxy: PROXY_URL, 
      headers: {
        ...BROWSER_HEADERS,
        'Accept': 'text/event-stream',
      },
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`Server responded with status ${response.status}`);

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/event-stream')) throw new Error('Unexpected response format from server');

    const result = await parseSSEStream(response);
    if (result.ok === false) throw new Error(result.error || result.message || 'The scraper could not process this link');

    const firstPresetThumb = (result.presetLinks || []).find(p => p.thumb)?.thumb;
    let cover = result.video?.cover || firstPresetThumb || null;
    let description = result.video?.description?.trim() || result.authorDetail?.nickname || '';
    let views = result.video?.stats?.views ?? null;
    let likes = result.video?.stats?.likes ?? null;
    let comments = result.video?.stats?.comments ?? null;

    // Fallback ke tikwm.com
    if (!cover || views == null) {
      try {
        const fb = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`, {
          impersonate: 'chrome124',
          proxy: PROXY_URL, 
          headers: BROWSER_HEADERS
        });
        const fbData = await fb.json();
        if (fbData?.code === 0 && fbData.data) {
          cover = cover || fbData.data.cover || fbData.data.origin_cover || null;
          description = description || fbData.data.title || '';
          views = views ?? fbData.data.play_count ?? null;
          likes = likes ?? fbData.data.digg_count ?? null;
          comments = comments ?? fbData.data.comment_count ?? null;
        }
      } catch (e) { console.error('Fallback tikwm error:', e.message); }
    }

    return {
      ok: true,
      author: result.author || result.authorDetail?.uniqueId || null,
      avatar: result.authorDetail?.avatar || null,
      video: {
        description, cover,
        playUrl: result.video?.playUrlNoWm || result.video?.playUrl || null,
        width: result.video?.width || null, height: result.video?.height || null,
        stats: { views, likes, comments },
      },
      presetLinks: (result.presetLinks || []).map((p) => ({
        title: p.title || (p.type === '5mb' ? '5MB preset' : 'XML file'),
        url: p.url, type: p.type, size: p.size || null, ratio: p.ratio || null,
        thumb: p.thumb || null, pinned: !!p.pinned, byAuthor: !!p.byAuthor, detail: p.detail || null,
      })),
    };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Request timed out. Please try again.');
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { get_preset_links };
