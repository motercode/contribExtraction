const SAFE_ORIGINS = ['google.com', 'maps.google.com'];
const GENERIC_PHOTO_COUNTER = /^(foto|photo|image)\s+\d+\s+(de|of)\s+\d+$/i;
const GENERIC_LABELS = [
  /^foto de perfil$/i,
  /^foto$/i,
  /^photo$/i,
  /^image$/i,
  /^sin t[ií]tulo$/i,
  /^acciones de la foto$/i,
  /^actions of the photo$/i,
  /^perfil$/i,
  /^profile$/i,
  /^avatar$/i,
  /^ver m[aá]s$/i,
  /^open photo$/i,
  /^abrir foto$/i
];
const GOOGLE_META_PATTERNS = [
  /accounts\.google\.com\/SignOutOptions/i,
  /google\.com\/images\/branding\//i,
  /mapslogo\//i,
  /google\.com\/maps\/preview/i,
  /google\.com\/maps\?hl=/i,
  /google\.com\/maps\/contrib\/.+\/photos\/@.*?data=.*entry=ttu/i
];

const isGoogleMapsPage = () => {
  const url = window.location.href || '';
  return SAFE_ORIGINS.some((origin) => url.includes(origin)) && (url.includes('/maps') || url.includes('google.com'));
};

const safeText = (value) => {
  if (!value) {
    return '';
  }

  return String(value)
    .replace(/\s+/g, ' ')
    .trim();
};

const normalizeUrl = (url) => {
  try {
    return new URL(url, window.location.href).toString();
  } catch {
    return '';
  }
};

const cleanImageUrl = (value) => {
  if (!value) {
    return '';
  }

  const match = String(value).match(/https?:\/\/[^\s"']+/i);
  return match ? match[0].replace(/&amp;/g, '&') : '';
};

const isContributionLikeUrl = (url) => {
  if (!url) {
    return false;
  }

  return /\/maps\/.*(?:contrib|photo|photos|review|reviews)|\/maps\/contrib\//i.test(url)
    || /\/maps\/.*(?:photo|photos|review|reviews)/i.test(url);
};

const isGoogleMetaItem = (title = '', url = '', imageUrl = '') => {
  const haystack = `${title} ${url} ${imageUrl}`.toLowerCase();
  if (!haystack) {
    return false;
  }

  if (GENERIC_LABELS.some((pattern) => pattern.test(title))) {
    return true;
  }

  if (/cuenta de google|google account|sign out|cerrar sesión|perfil de google|profile photo/i.test(title)) {
    return true;
  }

  return GOOGLE_META_PATTERNS.some((pattern) => pattern.test(haystack));
};

const findScrollableElement = () => {
  const candidates = Array.from(document.querySelectorAll('div, section, main, article, aside, body'));
  let best = null;

  for (const candidate of candidates) {
    const style = window.getComputedStyle(candidate);
    const overflow = style.overflowY || style.overflow;
    const canScroll = candidate.scrollHeight > candidate.clientHeight + 12;
    const visible = candidate.offsetWidth > 0 || candidate.offsetHeight > 0 || candidate === document.body;

    if (visible && canScroll && /(auto|scroll|overlay)/.test(overflow)) {
      if (!best || candidate.scrollHeight > best.scrollHeight) {
        best = candidate;
      }
    }
  }

  return best || document.scrollingElement || document.body;
};

const extractImageUrlFromNode = (node) => {
  const candidates = [];

  if (node && typeof node.querySelectorAll === 'function') {
    candidates.push(...node.querySelectorAll('img'));
  }

  if (node && node.tagName === 'IMG') {
    candidates.push(node);
  }

  for (const imageNode of candidates) {
    const value = cleanImageUrl(
      imageNode.currentSrc || imageNode.src || imageNode.getAttribute('src') || imageNode.getAttribute('data-src') || ''
    );

    if (value) {
      return value;
    }
  }

  return '';
};

const getNodeTitle = (node) => {
  const aria = safeText(node.getAttribute('aria-label') || node.getAttribute('title'));
  const text = safeText(node.innerText || node.textContent || '');
  const alt = safeText(node.getAttribute ? node.getAttribute('alt') : '');

  if (aria && !GENERIC_PHOTO_COUNTER.test(aria)) {
    return aria;
  }

  if (text && !GENERIC_PHOTO_COUNTER.test(text)) {
    return text;
  }

  if (alt && !GENERIC_PHOTO_COUNTER.test(alt)) {
    return alt;
  }

  return aria || text || alt || '';
};

const extractFromCurrentPage = () => {
  const seen = new Map();
  const items = [];
  const candidateNodes = Array.from(document.querySelectorAll('img, a[href], [data-photo-id], [data-review-id], [role="article"], [role="link"], article, div[jsname]'));

  for (const node of candidateNodes) {
    const href = node.href || node.getAttribute('href') || '';
    const candidateUrl = href ? normalizeUrl(href) : '';
    const imageUrl = extractImageUrlFromNode(node);
    const title = getNodeTitle(node);
    const combinedText = [title, candidateUrl, imageUrl].filter(Boolean).join(' ');

    if (!imageUrl && !candidateUrl && !title) {
      continue;
    }

    const isGenericPhotoCounter = GENERIC_PHOTO_COUNTER.test(title) || /^(foto|photo)\s+\d+\s+(de|of)\s+\d+$/i.test(safeText(node.textContent || ''));
    const isGoogleMeta = isGoogleMetaItem(title, candidateUrl, imageUrl);
    const hasRealContributionSignal = Boolean(imageUrl)
      || isContributionLikeUrl(candidateUrl)
      || !!node.getAttribute('data-photo-id')
      || !!node.getAttribute('data-review-id')
      || /contrib|review|photo|foto|publicaci|valoraci/i.test(combinedText);

    if (isGoogleMeta || !hasRealContributionSignal || (isGenericPhotoCounter && !imageUrl)) {
      continue;
    }

    if (!imageUrl && !isContributionLikeUrl(candidateUrl)) {
      continue;
    }

    const url = candidateUrl || window.location.href;
    const key = (imageUrl || url).toLowerCase();
    const finalTitle = GENERIC_LABELS.some((pattern) => pattern.test(title || '')) || GENERIC_PHOTO_COUNTER.test(title || '')
      ? 'Contribución de Google Maps'
      : (title || 'Sin título');

    const item = {
      title: finalTitle,
      text: finalTitle,
      url,
      imageUrl: imageUrl || null,
      sourceUrl: window.location.href,
      capturedAt: new Date().toISOString()
    };

    if (seen.has(key)) {
      const existing = seen.get(key);
      const existingGeneric = GENERIC_LABELS.some((pattern) => pattern.test(existing.title || ''));
      const currentGeneric = GENERIC_LABELS.some((pattern) => pattern.test(title || ''));

      if (!currentGeneric && existingGeneric) {
        seen.set(key, item);
        const index = items.findIndex((entry) => (entry.imageUrl || entry.url).toLowerCase() === key);
        if (index >= 0) {
          items[index] = item;
        }
      }
      continue;
    }

    seen.set(key, item);
    items.push(item);
  }

  return items.slice(0, 200);
};

const scrollPageForResults = async () => {
  const target = findScrollableElement();
  let previous = 0;
  let noProgress = 0;

  for (let step = 0; step < 24; step += 1) {
    const before = target.scrollTop || 0;
    const delta = Math.max(700, target.clientHeight || 800);
    target.scrollTop = before + delta;
    await new Promise((resolve) => setTimeout(resolve, 1200));

    const after = target.scrollTop || 0;
    if (Math.abs(after - before) < 2) {
      noProgress += 1;
    } else {
      noProgress = 0;
    }

    if (Math.abs((target.scrollHeight || 0) - previous) < 3) {
      noProgress += 1;
    }

    previous = target.scrollHeight || 0;

    if (noProgress >= 4) {
      break;
    }
  }
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isGoogleMapsPage()) {
    sendResponse({ ok: false, error: 'Abre una página de Google Maps antes de extraer contribuciones.' });
    return;
  }

  if (message.type === 'EXTRACT_CONTRIBUTIONS') {
    (async () => {
      try {
        await scrollPageForResults();
        const items = extractFromCurrentPage();
        sendResponse({ ok: true, items });
      } catch (error) {
        sendResponse({ ok: false, error: String(error) });
      }
    })();

    return true;
  }

  return false;
});
