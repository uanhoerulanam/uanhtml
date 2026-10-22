/**
 * AM Preset Finder Scraper (Updated Version)
 * Source: https://amfinder.web.id
 */

const BASE_URL = 'https://amfinder.web.id';

// HEADERS PALSU (Meniru Google Chrome asli di Windows)
// Ini sangat penting agar tidak diblokir sistem anti-bot TikTok/Vercel
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
  'Referer': 'https://www.tiktok.com/',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  // OPSIONAL: Jika masih 403, buka TikTok di browser PC, login, lalu copy Cookie-nya ke sini.
  // 'Cookie': 'tt_webid_v2=MASUKKAN_DEVICE_ID_DISINI; ms_token=MASUKKAN_TOKEN_DISINI;'
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
      try {
        return JSON.parse(dataStr);
      } catch {
        throw new Error('Unreadable response from server');
      }
    }

    if (evt === 'error' && dataStr) {
      try {
        const err = JSON.parse(dataStr);
        throw new Error(err.message || 'Something went wrong');
      } catch (e) {
        if (e instanceof SyntaxError) {
          throw new Error('Something went wrong, try again');
        }
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

      if (line.startsWith('event:')) {
        currentEvent = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
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

/**
 * Cari preset Alight Motion dari link video TikTok
 * @param {string} link_tiktok - URL video TikTok (mis. https://vt.tiktok.com/xxx)
 * @returns {Promise<object>}
 */
async function get_preset_links(link_tiktok) {
  const url = (link_tiktok || '').trim();

  if (!url) {
    throw new Error('TikTok video link is required');
  }
  if (!isValidTikTokUrl(url)) {
    throw new Error('That link is not from TikTok. Paste a TikTok video link first.');
  }

  const apiUrl = `${BASE_URL}/api/find?url=${encodeURIComponent(url)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    // Request ke API Utama (amfinder.web.id)
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        ...BROWSER_HEADERS,
        'Accept': 'text/event-stream', // Wajib untuk Server-Sent Events
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Server responded with status ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/event-stream')) {
      throw new Error('Unexpected response format from server');
    }

    const result = await parseSSEStream(response);

    if (result.ok === false) {
      throw new Error(result.error || result.message || 'The scraper could not process this link');
    }

    const firstPresetThumb = (result.presetLinks || []).find(p => p.thumb)?.thumb;

    let cover = result.video?.cover || firstPresetThumb || null;
    let description = result.video?.description?.trim() || result.authorDetail?.nickname || '';
    let views = result.video?.stats?.views ?? null;
    let likes = result.video?.stats?.likes ?? null;
    let comments = result.video?.stats?.comments ?? null;

    // FALLBACK 1: Jika API utama tidak memberikan cover atau views, ambil dari tikwm.com
    if (!cover || views == null) {
      try {
        const fb = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`, {
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
      } catch (e) {
        console.error('Fallback tikwm error:', e.message);
      }
    }

    return {
      ok: true,
      author: result.author || result.authorDetail?.uniqueId || null,
      avatar: result.authorDetail?.avatar || null,
      video: {
        description,
        cover,
        playUrl: result.video?.playUrlNoWm || result.video?.playUrl || null,
        width: result.video?.width || null,
        height: result.video?.height || null,
        stats: {
          views,
          likes,
          comments,
        },
      },
      presetLinks: (result.presetLinks || []).map((p) => ({
        title: p.title || (p.type === '5mb' ? '5MB preset' : 'XML file'),
        url: p.url,
        type: p.type,
        size: p.size || null,
        ratio: p.ratio || null,
        thumb: p.thumb || null,
        pinned: !!p.pinned,
        byAuthor: !!p.byAuthor,
        detail: p.detail || null,
      })),
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Request timed out. Please try again.');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { get_preset_links };

// Blok untuk testing via terminal (opsional)
if (require.main === module) {
  (async () => {
    try {
      const testUrl = process.argv[2] || 'https://vt.tiktok.com/ZSbmR9kCu/';
      console.log('Menguji scraper dengan:', testUrl);
      const result = await get_preset_links(testUrl);

      console.log('✅ Author:', result.author);
      console.log('📊 Views:', result.video.stats.views);
      console.log(`🔗 Ditemukan ${result.presetLinks.length} preset:\n`);

      for (const preset of result.presetLinks) {
        console.log(`  📌 ${preset.title}`);
        console.log(`     Type: ${preset.type} | Size: ${preset.size || '-'}`);
        console.log(`     URL: ${preset.url}`);
        console.log(`     By Author: ${preset.byAuthor ? 'Ya' : 'Tidak'}\n`);
      }
    } catch (err) {
      console.error('❌ Error:', err.message);
      process.exit(1);
    }
  })();
}
