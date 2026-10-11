(() => {
  'use strict';

  // Gunakan proxy backend lokal jika ada, atau direct upstream
  const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const API_ENDPOINT = (window.location.protocol.startsWith('http') && !window.location.host.includes('amfinder.web.id'))
    ? '/api/find'
    : 'https://amfinder.web.id/api/find';

  const REQUEST_TIMEOUT_MS = 60000;

  const form = document.getElementById('searchForm');
  const input = document.getElementById('tiktokUrl');
  const searchBtn = document.getElementById('searchBtn');
  const clearBtn = document.getElementById('clearBtn');
  const statusBox = document.getElementById('status');
  const videoCard = document.getElementById('videoCard');
  const presetsSection = document.getElementById('presetsSection');
  const presetList = document.getElementById('presetList');

  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  function isValidTikTokUrl(value) {
    const text = (value || '').trim();
    if (/^\d{15,}$/.test(text)) return true;
    try {
      const url = new URL(text);
      return /(^|\.)tiktok\.com$/i.test(url.hostname) && ['http:', 'https:'].includes(url.protocol);
    } catch {
      return false;
    }
  }

  function setStatus(type, message) {
    statusBox.className = `status ${type}`;
    statusBox.textContent = message;
    statusBox.hidden = false;
  }

  function clearStatus() {
    statusBox.hidden = true;
    statusBox.textContent = '';
    statusBox.className = 'status';
  }

  function resetResults() {
    videoCard.hidden = true;
    presetsSection.hidden = true;
    presetList.replaceChildren();
  }

  function formatNumber(value) {
    if (value === null || value === undefined || value === '') return '—';
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value);
    return new Intl.NumberFormat('id-ID', { notation: number >= 1000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(number);
  }

  async function parseSSEStream(response) {
    if (!response.body) {
      return parseSSEText(await response.text());
    }

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
          throw new Error('Respons server tidak dapat dibaca.');
        }
      }
      if (evt === 'error' && dataStr) {
        let detail = 'Server gagal memproses tautan.';
        try {
          detail = JSON.parse(dataStr).message || detail;
        } catch {}
        throw new Error(detail);
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

    // Flush baris sisa di akhir stream
    if (buffer.trim()) {
      const line = buffer.trim();
      if (line.startsWith('event:')) currentEvent = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }

    const finalRes = dispatchEvent();
    if (finalRes) return finalRes;

    throw new Error('Koneksi berakhir sebelum hasil diterima.');
  }

  function parseSSEText(text) {
    const lines = text.split(/\r?\n/);
    let eventName = null;
    let dataLines = [];

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (!line) {
        if (eventName === 'result' && dataLines.length) {
          try { return JSON.parse(dataLines.join('\n')); } catch {}
        }
        if (eventName === 'error' && dataLines.length) {
          let msg = 'Server gagal memproses tautan.';
          try { msg = JSON.parse(dataLines.join('\n')).message || msg; } catch {}
          throw new Error(msg);
        }
        eventName = null;
        dataLines = [];
        continue;
      }

      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    if (eventName === 'result' && dataLines.length) {
      try { return JSON.parse(dataLines.join('\n')); } catch {}
    }

    // Coba fallback parse JSON langsung
    try {
      const json = JSON.parse(text);
      if (json && typeof json === 'object') return json;
    } catch {}

    throw new Error('Server tidak mengirim hasil yang dikenali.');
  }

  async function getPresetLinks(tiktokUrl) {
    const fetchUrl = `${API_ENDPOINT}?url=${encodeURIComponent(tiktokUrl)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      let response;
      try {
        response = await fetch(fetchUrl, {
          method: 'GET',
          headers: { 'Accept': 'text/event-stream, application/json' },
          signal: controller.signal
        });
      } catch (err) {
        // Jika fetch endpoint lokal gagal (misal dijalankan via file://), coba direct amfinder
        if (API_ENDPOINT !== 'https://amfinder.web.id/api/find') {
          response = await fetch(`https://amfinder.web.id/api/find?url=${encodeURIComponent(tiktokUrl)}`, {
            method: 'GET',
            headers: { 'Accept': 'text/event-stream, application/json' },
            signal: controller.signal
          });
        } else {
          throw err;
        }
      }

      if (!response.ok) throw new Error(`Server merespons dengan status ${response.status}.`);
      const result = await parseSSEStream(response);
      if (result.ok === false) throw new Error(result.message || result.error || 'Server tidak dapat memproses tautan ini.');

      // Cari cover fallback jika video cover null
      const firstPresetThumb = (result.presetLinks || []).find(p => p.thumb)?.thumb;
      const coverUrl = result.video?.cover || firstPresetThumb || result.authorDetail?.avatar || null;

      return {
        author: result.author || result.authorDetail?.uniqueId || null,
        video: {
          description: result.video?.description?.trim() || result.authorDetail?.nickname || '',
          cover: coverUrl,
          stats: {
            views: result.video?.stats?.views ?? null,
            likes: result.video?.stats?.likes ?? null,
            comments: result.video?.stats?.comments ?? null
          }
        },
        presetLinks: (result.presetLinks || []).map(p => ({
          title: p.title || (p.type === '5mb' ? 'Preset 5MB' : 'File XML'),
          url: p.url || '',
          type: p.type || 'xml',
          size: p.size || null,
          thumb: p.thumb || null,
          pinned: Boolean(p.pinned),
          byAuthor: Boolean(p.byAuthor)
        })).filter(p => isSafeHttpUrl(p.url))
      };
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('Permintaan terlalu lama. Coba lagi.');
      if (error instanceof TypeError) {
        throw new Error('Tidak bisa menghubungi API. Pastikan server lokal aktif (npm start) atau tidak terblokir CORS.');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  function isSafeHttpUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
      return false;
    }
  }

  function makeBadge(text, extraClass = '') {
    const badge = document.createElement('span');
    badge.className = `badge ${extraClass}`.trim();
    badge.textContent = text;
    return badge;
  }

  function renderVideo(result) {
    const cover = document.getElementById('videoCover');
    const placeholder = document.getElementById('coverPlaceholder');
    if (result.video.cover && isSafeHttpUrl(result.video.cover)) {
      cover.src = result.video.cover;
      cover.hidden = false;
      placeholder.hidden = true;
      cover.onerror = () => { cover.hidden = true; placeholder.hidden = false; };
    } else {
      cover.removeAttribute('src');
      cover.hidden = true;
      placeholder.hidden = false;
    }

    const rawAuthor = result.author || '';
    const cleanAuthor = rawAuthor ? (rawAuthor.startsWith('@') ? rawAuthor : `@${rawAuthor}`) : 'Informasi kreator tidak tersedia';

    document.getElementById('authorName').textContent = cleanAuthor;
    document.getElementById('videoHeading').textContent = result.video.description || 'Preset Alight Motion';
    document.getElementById('viewsCount').textContent = formatNumber(result.video.stats.views);
    document.getElementById('likesCount').textContent = formatNumber(result.video.stats.likes);
    document.getElementById('commentsCount').textContent = formatNumber(result.video.stats.comments);
    videoCard.hidden = false;
  }

  function renderPresets(presets) {
    presetsSection.hidden = false;
    document.getElementById('presetCount').textContent = `${presets.length} preset`;
    presetList.replaceChildren();

    if (!presets.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'Tidak ada tautan preset yang ditemukan pada video ini.';
      presetList.appendChild(empty);
      return;
    }

    presets.forEach(preset => {
      const item = document.createElement('article');
      item.className = 'preset-item';

      const symbol = document.createElement('div');
      symbol.className = 'preset-symbol';
      symbol.textContent = preset.type === '5mb' ? '✦' : '⌘';
      symbol.setAttribute('aria-hidden', 'true');

      const main = document.createElement('div');
      main.className = 'preset-main';
      const title = document.createElement('h3');
      title.className = 'preset-title';
      title.textContent = preset.title;
      const badges = document.createElement('div');
      badges.className = 'badges';
      badges.appendChild(makeBadge(preset.type === '5mb' ? 'PRESET 5MB' : String(preset.type).toUpperCase(), preset.type === 'xml' ? 'xml' : ''));
      if (preset.size) badges.appendChild(makeBadge(preset.size, 'size'));
      if (preset.byAuthor) badges.appendChild(makeBadge('OLEH KREATOR'));
      if (preset.pinned) badges.appendChild(makeBadge('★ PILIHAN', 'pinned'));
      main.append(title, badges);

      const download = document.createElement('a');
      download.className = 'download-btn';
      download.href = preset.url;
      download.target = '_blank';
      download.rel = 'noopener noreferrer';
      download.textContent = 'Unduh ↗';
      download.setAttribute('aria-label', `Buka tautan unduhan ${preset.title}`);

      item.append(symbol, main, download);
      presetList.appendChild(item);
    });
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const url = input.value.trim();
    clearStatus();
    resetResults();

    if (!url) {
      setStatus('error', 'Masukkan tautan video TikTok terlebih dahulu.');
      input.focus();
      return;
    }
    if (!isValidTikTokUrl(url)) {
      setStatus('error', 'Tautan tidak valid. Masukkan URL video TikTok, misalnya https://vt.tiktok.com/...');
      input.focus();
      return;
    }

    searchBtn.disabled = true;
    searchBtn.querySelector('.button-label').textContent = 'Sedang mencari…';
    searchBtn.querySelector('.button-arrow').textContent = '…';
    setStatus('info', 'Menghubungi server dan mencari preset. Proses ini memerlukan waktu hingga 60 detik...');

    try {
      const result = await getPresetLinks(url);
      renderVideo(result);
      renderPresets(result.presetLinks);
      setStatus('success', `Pencarian selesai. Ditemukan ${result.presetLinks.length} preset.`);
    } catch (error) {
      setStatus('error', error.message || 'Terjadi kesalahan yang tidak diketahui.');
    } finally {
      searchBtn.disabled = false;
      searchBtn.querySelector('.button-label').textContent = 'Cari preset';
      searchBtn.querySelector('.button-arrow').textContent = '→';
    }
  });

  input.addEventListener('input', () => {
    clearBtn.hidden = input.value.length === 0;
  });
  clearBtn.addEventListener('click', () => {
    input.value = '';
    clearBtn.hidden = true;
    clearStatus();
    resetResults();
    input.focus();
  });
})();
