
(() => {
  'use strict';

  const API_ENDPOINT =
    window.location.protocol.startsWith('http') &&
    !window.location.host.includes('amfinder.web.id')
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
  const player = document.getElementById('tiktokPlayer');
  const frame = document.getElementById('tiktokFrame');

  const yearEl = document.getElementById('year');

  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }

  function isValidTikTokUrl(value) {
    const text = (value || '').trim();

    if (/^\d{15,}$/.test(text)) return true;

    try {
      const url = new URL(text);

      return (
        /(^|\.)tiktok\.com$/i.test(url.hostname) &&
        ['http:', 'https:'].includes(url.protocol)
      );
    } catch {
      return false;
    }
  }

  function isSafeHttpUrl(value) {
    try {
      const url = new URL(value);

      return (
        url.protocol === 'https:' ||
        url.protocol === 'http:'
      );
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

    if (player && frame) {
      player.hidden = true;
      frame.src = 'about:blank';
    }
  }

  function formatNumber(value) {
    if (
      value === null ||
      value === undefined ||
      value === ''
    ) {
      return '—';
    }

    const number = Number(value);

    if (!Number.isFinite(number)) {
      return String(value);
    }

    return new Intl.NumberFormat('id-ID', {
      notation: number >= 1000 ? 'compact' : 'standard',
      maximumFractionDigits: 1
    }).format(number);
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
      if (!currentEvent && dataLines.length === 0) {
        return null;
      }

      const dataStr = dataLines.join('\n').trim();
      const eventName = currentEvent;

      currentEvent = null;
      dataLines = [];

      if (eventName === 'result' && dataStr) {
        try {
          return JSON.parse(dataStr);
        } catch {
          throw new Error(
            'Respons server tidak dapat dibaca.'
          );
        }
      }

      if (eventName === 'error' && dataStr) {
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

      buffer += decoder.decode(value, {
        stream: true
      });

      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';

      for (const rawLine of lines) {
        const line = rawLine.trimEnd();

        if (!line) {
          const result = dispatchEvent();

          if (result) return result;

          continue;
        }

        if (line.startsWith('event:')) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
    }

    buffer += decoder.decode();

    if (buffer.trim()) {
      const line = buffer.trim();

      if (line.startsWith('event:')) {
        currentEvent = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    const finalResult = dispatchEvent();

    if (finalResult) return finalResult;

    throw new Error(
      'Koneksi berakhir sebelum hasil diterima.'
    );
  }

  function parseSSEText(text) {
    const lines = text.split(/\r?\n/);

    let eventName = null;
    let dataLines = [];

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();

      if (!line) {
        if (eventName === 'result' && dataLines.length) {
          try {
            return JSON.parse(dataLines.join('\n'));
          } catch {}
        }

        if (eventName === 'error' && dataLines.length) {
          let message = 'Server gagal memproses tautan.';

          try {
            message =
              JSON.parse(dataLines.join('\n')).message ||
              message;
          } catch {}

          throw new Error(message);
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
      try {
        return JSON.parse(dataLines.join('\n'));
      } catch {}
    }

    try {
      const json = JSON.parse(text);

      if (json && typeof json === 'object') {
        return json;
      }
    } catch {}

    throw new Error(
      'Server tidak mengirim hasil yang dikenali.'
    );
  }

  async function fetchTikTokFallback(tiktokUrl) {
    try {
      const response = await fetch(
        `https://www.tikwm.com/api/?url=${encodeURIComponent(tiktokUrl)}`
      );

      const data = await response.json();

      if (data && data.code === 0 && data.data) {
        return {
          cover:
            data.data.cover ||
            data.data.origin_cover ||
            null,
          title: data.data.title || null,
          views: data.data.play_count ?? null,
          likes: data.data.digg_count ?? null,
          comments: data.data.comment_count ?? null
        };
      }
    } catch {}

    return null;
  }

  async function getPresetLinks(tiktokUrl) {
    const fetchUrl =
      `${API_ENDPOINT}?url=${encodeURIComponent(tiktokUrl)}`;

    const controller = new AbortController();

    const timeout = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS
    );

    try {
      let response;

      try {
        response = await fetch(fetchUrl, {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream, application/json'
          },
          signal: controller.signal
        });
      } catch (error) {
        if (
          API_ENDPOINT !==
          'https://amfinder.web.id/api/find'
        ) {
          response = await fetch(
            `https://amfinder.web.id/api/find?url=${encodeURIComponent(tiktokUrl)}`,
            {
              method: 'GET',
              headers: {
                Accept: 'text/event-stream, application/json'
              },
              signal: controller.signal
            }
          );
        } else {
          throw error;
        }
      }

      if (!response.ok) {
        throw new Error(
          `Server merespons dengan status ${response.status}.`
        );
      }

      const result = await parseSSEStream(response);

      if (result.ok === false) {
        throw new Error(
          result.message ||
          result.error ||
          'Server tidak dapat memproses tautan ini.'
        );
      }

      let fallbackMeta = null;

      if (
        !result.video?.cover ||
        result.video?.stats?.views == null
      ) {
        fallbackMeta = await fetchTikTokFallback(tiktokUrl);
      }

      const firstPresetThumb = (result.presetLinks || [])
        .find(preset => preset.thumb)?.thumb;

      const coverUrl =
        result.video?.cover ||
        fallbackMeta?.cover ||
        firstPresetThumb ||
        result.authorDetail?.avatar ||
        null;

      const description =
        result.video?.description?.trim() ||
        fallbackMeta?.title ||
        result.authorDetail?.nickname ||
        '';

      const views =
        result.video?.stats?.views ??
        fallbackMeta?.views ??
        null;

      const likes =
        result.video?.stats?.likes ??
        fallbackMeta?.likes ??
        null;

      const comments =
        result.video?.stats?.comments ??
        fallbackMeta?.comments ??
        null;

      return {
        author:
          result.author ||
          result.authorDetail?.uniqueId ||
          null,

        videoId:
          result.video?.id ||
          result.video?.videoId ||
          result.video?.aweme_id ||
          null,

        video: {
          description,
          cover: coverUrl,
          stats: {
            views,
            likes,
            comments
          }
        },

        presetLinks: (result.presetLinks || [])
          .map(preset => ({
            title:
              preset.title ||
              (preset.type === '5mb'
                ? 'Preset 5MB'
                : 'File XML'),

            url: preset.url || '',

            type: preset.type || 'xml',

            size: preset.size || null,

            thumb: preset.thumb || null,

            pinned: Boolean(preset.pinned),

            byAuthor: Boolean(preset.byAuthor)
          }))
          .filter(preset => isSafeHttpUrl(preset.url))
      };
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(
          'Permintaan terlalu lama. Coba lagi.'
        );
      }

      if (error instanceof TypeError) {
        throw new Error(
          'Tidak bisa menghubungi API. Pastikan server aktif atau koneksi tidak terblokir.'
        );
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  function makeBadge(text, extraClass = '') {
    const badge = document.createElement('span');

    badge.className = `badge ${extraClass}`.trim();
    badge.textContent = text;

    return badge;
  }

  function makeSymbol(type) {
    const symbol = document.createElement('div');

    symbol.className = 'preset-symbol';
    symbol.textContent = type === '5mb' ? '✦' : '⌘';
    symbol.setAttribute('aria-hidden', 'true');

    return symbol;
  }

  function renderVideo(result) {
    const cover = document.getElementById('videoCover');
    const placeholder =
      document.getElementById('coverPlaceholder');

    if (
      result.video.cover &&
      isSafeHttpUrl(result.video.cover)
    ) {
      cover.referrerPolicy = 'no-referrer';
      cover.src = result.video.cover;
      cover.hidden = false;
      placeholder.hidden = true;

      cover.onerror = () => {
        cover.removeAttribute('src');
        cover.hidden = true;
        placeholder.hidden = false;
      };
    } else {
      cover.removeAttribute('src');
      cover.hidden = true;
      placeholder.hidden = false;
    }

    const rawAuthor = result.author || '';

    const cleanAuthor = rawAuthor
      ? (
          rawAuthor.startsWith('@')
            ? rawAuthor
            : `@${rawAuthor}`
        )
      : 'Informasi kreator tidak tersedia';

    document.getElementById('authorName').textContent =
      cleanAuthor;

    document.getElementById('videoHeading').textContent =
      result.video.description || 'Preset Alight Motion';

    document.getElementById('viewsCount').textContent =
      formatNumber(result.video.stats.views);

    document.getElementById('likesCount').textContent =
      formatNumber(result.video.stats.likes);

    document.getElementById('commentsCount').textContent =
      formatNumber(result.video.stats.comments);

    videoCard.hidden = false;
  }

  // Mengambil ID video dari tautan TikTok.
  function extractTikTokVideoId(videoUrl) {
    try {
      const parsedUrl = new URL(videoUrl);

      if (!/(^|\.)tiktok\.com$/i.test(parsedUrl.hostname)) {
        return null;
      }

      const match =
        parsedUrl.pathname.match(/\/video\/(\d+)/);

      return match ? match[1] : null;
    } catch {
      return null;
    }
  }

  // Mencoba mendapatkan ID video dari layanan oEmbed TikTok.
  async function resolveTikTokVideoId(videoUrl) {
    const directId = extractTikTokVideoId(videoUrl);

    if (directId) return directId;

    try {
      const response = await fetch(
        `https://www.tiktok.com/oembed?url=${encodeURIComponent(videoUrl)}`
      );

      if (!response.ok) return null;

      const data = await response.json();

      const html = data.html || '';

      const patterns = [
        /\/player\/v1\/(\d+)/,
        /\/embed\/v2\/(\d+)/,
        /data-video-id=["'](\d+)["']/,
        /video\/(\d+)/
      ];

      for (const pattern of patterns) {
        const match = html.match(pattern);

        if (match) return match[1];
      }
    } catch {}

    return null;
  }

  // Menampilkan video menggunakan pemutar resmi TikTok.
  async function showTikTokPlayer(videoUrl, knownVideoId) {
    if (!player || !frame) return;

    player.hidden = true;
    frame.src = 'about:blank';

    let videoId =
      knownVideoId && /^\d+$/.test(String(knownVideoId))
        ? String(knownVideoId)
        : null;

    if (!videoId) {
      videoId = await resolveTikTokVideoId(videoUrl);
    }

    if (!videoId) {
      return;
    }

    frame.src =
      `https://www.tiktok.com/player/v1/${videoId}` +
      '?music_info=1&description=1';

    player.hidden = false;
  }

  // Menyalin tautan preset.
  async function copyPresetLink(url, button) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url);
      } else {
        const temp = document.createElement('textarea');

        temp.value = url;
        temp.setAttribute('readonly', '');
        temp.style.position = 'fixed';
        temp.style.left = '-9999px';

        document.body.appendChild(temp);
        temp.select();
        temp.setSelectionRange(0, temp.value.length);

        const copied = document.execCommand('copy');

        temp.remove();

        if (!copied) {
          throw new Error('Gagal menyalin tautan.');
        }
      }

      button.textContent = 'Tersalin ✓';
    } catch {
      button.textContent = 'Gagal menyalin';
    }

    button.disabled = true;

    setTimeout(() => {
      button.textContent = 'Copy Link';
      button.disabled = false;
    }, 2000);
  }

  function renderPresets(presets) {
    presetsSection.hidden = false;

    document.getElementById('presetCount').textContent =
      `${presets.length} preset`;

    presetList.replaceChildren();

    if (!presets.length) {
      const empty = document.createElement('div');

      empty.className = 'empty-state';
      empty.textContent =
        'Tidak ada tautan preset yang ditemukan pada video ini.';

      presetList.appendChild(empty);

      return;
    }

    presets.forEach(preset => {
      const item = document.createElement('article');

      item.className = 'preset-item';

      let visualEl;

      if (
        preset.thumb &&
        isSafeHttpUrl(preset.thumb)
      ) {
        const img = document.createElement('img');

        img.className = 'preset-thumb';
        img.src = preset.thumb;
        img.alt = preset.title;
        img.referrerPolicy = 'no-referrer';

        img.onerror = () => {
          img.replaceWith(makeSymbol(preset.type));
        };

        visualEl = img;
      } else {
        visualEl = makeSymbol(preset.type);
      }

      const main = document.createElement('div');

      main.className = 'preset-main';

      const title = document.createElement('h3');

      title.className = 'preset-title';
      title.textContent = preset.title;

      const badges = document.createElement('div');

      badges.className = 'badges';

      badges.appendChild(
        makeBadge(
          preset.type === '5mb'
            ? 'PRESET 5MB'
            : String(preset.type).toUpperCase(),
          preset.type === 'xml' ? 'xml' : ''
        )
      );

      if (preset.size) {
        badges.appendChild(
          makeBadge(preset.size, 'size')
        );
      }

      if (preset.byAuthor) {
        badges.appendChild(
          makeBadge('OLEH KREATOR')
        );
      }

      if (preset.pinned) {
        badges.appendChild(
          makeBadge('★ PILIHAN', 'pinned')
        );
      }

      main.append(title, badges);

      const actions = document.createElement('div');

      actions.className = 'preset-actions';

      const copyBtn = document.createElement('button');

      copyBtn.className = 'copy-btn';
      copyBtn.type = 'button';
      copyBtn.textContent = 'Copy Link';

      copyBtn.addEventListener('click', () => {
        copyPresetLink(preset.url, copyBtn);
      });

      const openBtn = document.createElement('a');

      openBtn.className = 'open-btn';
      openBtn.href = preset.url;
      openBtn.target = '_blank';
      openBtn.rel = 'noopener noreferrer';
      openBtn.textContent = 'Buka Link ↗';

      openBtn.setAttribute(
        'aria-label',
        `Buka tautan preset ${preset.title}`
      );

      actions.append(copyBtn, openBtn);

      item.append(visualEl, main, actions);

      presetList.appendChild(item);
    });
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();

    const url = input.value.trim();

    clearStatus();
    resetResults();

    if (!url) {
      setStatus(
        'error',
        'Masukkan tautan video TikTok terlebih dahulu.'
      );

      input.focus();

      return;
    }

    if (!isValidTikTokUrl(url)) {
      setStatus(
        'error',
        'Tautan tidak valid. Masukkan URL video TikTok, misalnya https://vt.tiktok.com/...'
      );

      input.focus();

      return;
    }

    searchBtn.disabled = true;

    searchBtn.querySelector('.button-label').textContent =
      'Sedang mencari…';

    searchBtn.querySelector('.button-arrow').textContent =
      '…';

    setStatus(
      'info',
      'Menghubungi server dan mencari preset. Proses ini memerlukan waktu hingga 60 detik...'
    );

    try {
      const result = await getPresetLinks(url);

      renderVideo(result);

      renderPresets(result.presetLinks);

      setStatus(
        'success',
        `Pencarian selesai. Ditemukan ${result.presetLinks.length} preset.`
      );

      // Pemutar TikTok tidak menghalangi hasil pencarian.
      showTikTokPlayer(url, result.videoId);
    } catch (error) {
      setStatus(
        'error',
        error.message ||
        'Terjadi kesalahan yang tidak diketahui.'
      );
    } finally {
      searchBtn.disabled = false;

      searchBtn.querySelector('.button-label').textContent =
        'Cari preset';

      searchBtn.querySelector('.button-arrow').textContent =
        '→';
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
