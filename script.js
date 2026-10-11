(() => {
  'use strict';

  const API_BASE_URL = 'https://amfinder.web.id';
  const REQUEST_TIMEOUT_MS = 60000;

  const form = document.getElementById('searchForm');
  const input = document.getElementById('tiktokUrl');
  const searchBtn = document.getElementById('searchBtn');
  const clearBtn = document.getElementById('clearBtn');
  const statusBox = document.getElementById('status');
  const videoCard = document.getElementById('videoCard');
  const presetsSection = document.getElementById('presetsSection');
  const presetList = document.getElementById('presetList');

  document.getElementById('year').textContent = new Date().getFullYear();

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

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('event:')) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          const data = line.slice(5).trim();
          if (currentEvent === 'result') {
            try { return JSON.parse(data); }
            catch { throw new Error('Respons server tidak dapat dibaca.'); }
          }
          if (currentEvent === 'error') {
            let detail = 'Server gagal memproses tautan.';
            try { detail = JSON.parse(data).message || detail; } catch {}
            throw new Error(detail);
          }
        }
      }
    }
    if (buffer.startsWith('data:') && currentEvent === 'result') {
      try { return JSON.parse(buffer.slice(5).trim()); } catch {}
    }
    throw new Error('Koneksi berakhir sebelum hasil diterima.');
  }

  function parseSSEText(text) {
    const lines = text.split(/\r?\n/);
    let eventName = '';
    for (const line of lines) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      if (line.startsWith('data:')) {
        const data = line.slice(5).trim();
        if (eventName === 'result') {
          try { return JSON.parse(data); } catch { throw new Error('Respons server tidak valid.'); }
        }
        if (eventName === 'error') {
          let message = 'Server gagal memproses tautan.';
          try { message = JSON.parse(data).message || message; } catch {}
          throw new Error(message);
        }
      }
    }
    try {
      const json = JSON.parse(text);
      if (json && typeof json === 'object') return json;
    } catch {}
    throw new Error('Server tidak mengirim hasil yang dikenali.');
  }

  async function getPresetLinks(tiktokUrl) {
    const apiUrl = `${API_BASE_URL}/api/find?url=${encodeURIComponent(tiktokUrl)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: { 'Accept': 'text/event-stream, application/json' },
        signal: controller.signal
      });

      if (!response.ok) throw new Error(`Server merespons dengan status ${response.status}.`);
      const result = await parseSSEStream(response);
      if (result.ok === false) throw new Error(result.error || 'Server tidak dapat memproses tautan ini.');

      return {
        author: result.author || null,
        video: {
          description: result.video?.description?.trim() || '',
          cover: result.video?.cover || null,
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
          pinned: Boolean(p.pinned),
          byAuthor: Boolean(p.byAuthor)
        })).filter(p => isSafeHttpUrl(p.url))
      };
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('Permintaan terlalu lama. Coba lagi.');
      if (error instanceof TypeError) {
        throw new Error('Tidak bisa menghubungi API. Bisa jadi server memblokir akses browser (CORS) atau sedang tidak tersedia.');
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

    document.getElementById('authorName').textContent = result.author ? `@${result.author}` : 'Informasi kreator tidak tersedia';
    document.getElementById('videoHeading').textContent = result.video.description || 'Video tanpa deskripsi';
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
    setStatus('info', 'Menghubungi server dan mencari preset. Proses ini bisa memerlukan waktu hingga 60 detik.');

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
