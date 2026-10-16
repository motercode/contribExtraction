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
  const isConsentPage = /consent\.google\.com\//i.test(url) || /continue=.*maps/i.test(url);
  return SAFE_ORIGINS.some((origin) => url.includes(origin)) && (url.includes('/maps') || isConsentPage || url.includes('google.com'));
};

const clickGoogleConsentButton = async () => {
  const maxAttempts = 20;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const consentNode = Array.from(document.querySelectorAll('button, [role="button"], a, div, span')).find((node) => {
      const text = safeText(node.textContent || node.getAttribute('aria-label') || node.getAttribute('title') || '');
      return /rechazar todo|reject all|aceptar todo|accept all/i.test(text);
    });

    if (consentNode) {
      consentNode.click();
      await new Promise((resolve) => setTimeout(resolve, 1400));
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return false;
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

const extractCoordinatesFromUrl = (url = '') => {
  const match = String(url).match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i);

  if (!match) {
    return null;
  }

  const latitude = Number(match[1]);
  const longitude = Number(match[2]);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    latitude,
    longitude
  };
};

const isFullContributionDetailUrl = (url = '') => {
  const normalized = String(url || '');
  if (!normalized) {
    return false;
  }

  const hasContribPath = /\/maps\/contrib\/.*\/photos\//i.test(normalized);
  const hasCameraBlock = /@-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?,\d+(?:\.\d+)?a,\d+(?:\.\d+)?y,\d+(?:\.\d+)?h,\d+(?:\.\d+)?t,-?\d+(?:\.\d+)?r\//i.test(normalized);
  const hasPhotoDataShape = /\/data=!3m7!1e1!3m5!/i.test(normalized) && /!2e10!6shttps:/i.test(normalized);

  return hasContribPath && hasCameraBlock && hasPhotoDataShape;
};

const scoreContributionUrl = (url = '') => {
  const normalized = String(url || '').trim();
  if (!normalized) {
    return -1;
  }

  let score = 0;
  if (/\/maps\/contrib\/.*\/photos\//i.test(normalized)) score += 3;
  if (/@-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?/i.test(normalized)) score += 2;
  if (/,\d+(?:\.\d+)?y,\d+(?:\.\d+)?h,\d+(?:\.\d+)?t,-?\d+(?:\.\d+)?r\//i.test(normalized)) score += 4;
  if (/\/data=!3m7!1e1!3m5!/i.test(normalized)) score += 4;
  if (/!2e10!6shttps:/i.test(normalized)) score += 2;

  // Penalize the short/alternate shape that loses expected perspective fields.
  if (/,15y\/data=!3m8/i.test(normalized)) score -= 3;
  if (/!3e12!/i.test(normalized)) score -= 2;

  return score;
};

const pickBestContributionUrl = (candidates = []) => {
  let best = '';
  let bestScore = -1;

  for (const value of candidates) {
    const normalized = String(value || '').trim();
    if (!normalized) {
      continue;
    }

    const score = scoreContributionUrl(normalized);
    if (score > bestScore) {
      best = normalized;
      bestScore = score;
    }
  }

  return best;
};

const resolveContributionUrl = (node, directHref = '') => {
  const closestLink = node && typeof node.closest === 'function' ? node.closest('a[href]') : null;
  const href = closestLink ? closestLink.href : directHref;
  const normalized = href ? normalizeUrl(href) : '';

  if (normalized && isContributionLikeUrl(normalized)) {
    return normalized;
  }

  return normalized || (directHref ? normalizeUrl(directHref) : '');
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

const isLikelyAvatarImage = (value = '') => {
  const normalized = String(value || '').toLowerCase();

  if (!normalized) {
    return false;
  }

  return /\/a-\//i.test(normalized)
    || /w72-h72|w144-h144|w96-h96|w48-h48/i.test(normalized)
    || /profile.*google|google.*profile/i.test(normalized);
};

const pickBestImageUrl = (images = []) => {
  const preferred = [];
  const fallback = [];

  for (const imageNode of images) {
    const value = cleanImageUrl(
      imageNode.currentSrc || imageNode.src || imageNode.getAttribute('src') || imageNode.getAttribute('data-src') || ''
    );

    if (!value || isLikelyAvatarImage(value)) {
      continue;
    }

    if (/gps-cs|gpms-cs|googleusercontent\.com/.test(value)) {
      if (/w1200-h|w900-h|w600-h|w800-h/.test(value)) {
        preferred.push(value);
      } else {
        fallback.push(value);
      }
    }
  }

  if (preferred.length) {
    return preferred[0];
  }

  if (fallback.length) {
    return fallback[0];
  }

  return '';
};

const extractImageUrlFromNode = (node) => {
  const candidates = [];

  if (node && typeof node.querySelectorAll === 'function') {
    candidates.push(...node.querySelectorAll('img'));
  }

  if (node && node.tagName === 'IMG') {
    candidates.push(node);
  }

  return pickBestImageUrl(candidates);
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
    const candidateUrl = resolveContributionUrl(node, href);
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
    const coordinates = extractCoordinatesFromUrl(url);
    const key = `${(imageUrl || url).toLowerCase()}|${(candidateUrl || '').toLowerCase()}`;
    const finalTitle = GENERIC_LABELS.some((pattern) => pattern.test(title || '')) || GENERIC_PHOTO_COUNTER.test(title || '')
      ? 'Contribución de Google Maps'
      : (title || 'Sin título');

    const item = {
      title: finalTitle,
      text: finalTitle,
      url,
      imageUrl: imageUrl || null,
      sourceUrl: window.location.href,
      coordinates: coordinates || null,
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

let galleryCursor = 0;

const resetGalleryCursor = () => {
  galleryCursor = 0;
};

const findGalleryPhotoButtons = () => {
  const labeled = Array.from(document.querySelectorAll('button, [role="button"], [data-photo-bucket-iden], [data-photo-id], [data-review-id], a[href]')).filter((button) => {
    const label = safeText(button.getAttribute('aria-label') || button.textContent || '');
    const isGalleryCounter = /foto\s+\d+\s+de\s+\d+|photo\s+\d+\s+of\s+\d+/i.test(label);
    const isActionLabel = /acciones de la foto|actions of the photo|foto de perfil|profile photo/i.test(label);
    const hasBucketId = !!button.getAttribute('data-photo-bucket-iden') || !!button.getAttribute('data-photo-id') || !!button.getAttribute('data-review-id');
    return (isGalleryCounter || hasBucketId) && !isActionLabel;
  });

  if (labeled.length > 0) {
    return labeled;
  }

  // Fallback: .xUc6Hf elements inside photo-card containers (photos 7-10 when not fully loaded)
  return Array.from(document.querySelectorAll('.EGN8xd > .WY21Hc > .xUc6Hf, .xUc6Hf, [data-photo-bucket-iden]'));
};

const waitForUrlChange = async (previousUrl, timeoutMs = 12000) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (window.location.href !== previousUrl) {
      return window.location.href;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return window.location.href;
};

// Waits until window.location.href stops changing for stableMs, then returns it.
const waitForUrlStable = async (timeoutMs = 5000, stableMs = 1000) => {
  const startedAt = Date.now();
  let lastUrl = window.location.href;
  let lastChangeAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const current = window.location.href;
    if (current !== lastUrl) {
      lastUrl = current;
      lastChangeAt = Date.now();
    } else if (Date.now() - lastChangeAt >= stableMs) {
      return lastUrl;
    }
  }

  return window.location.href;
};

const waitForFullContributionUrl = async (previousUrl, timeoutMs = 12000) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const current = window.location.href;
    if (current !== previousUrl && isFullContributionDetailUrl(current)) {
      return current;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return '';
};

// Captures thumbnail srcs from <img decoding="async"> with centering inline styles.
// These are the profile-page thumbnail images — all loaded in the SPA DOM before any click.
const captureViewerThumbnailSrcs = () =>
  Array.from(document.querySelectorAll('img[decoding="async"]'))
    .filter((img) => {
      const style = img.getAttribute('style') || '';
      return (
        /position\s*:\s*absolute/i.test(style) &&
        /top\s*:\s*50%/i.test(style) &&
        /left\s*:\s*50%/i.test(style)
      );
    })
    .map((img) => (img.currentSrc || img.src || '').trim())
    .filter((src) => /lh3\.googleusercontent\.com/i.test(src));

const collectCurrentDetailItem = (currentUrl = window.location.href, preImageUrl = null) => {
  const normalizedUrl = String(currentUrl || '').trim();
  if (!normalizedUrl || !/\/maps\/contrib\/.*\/photos\//i.test(normalizedUrl) || !/@-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?/i.test(normalizedUrl)) {
    return null;
  }

  // Prefer pre-captured thumbnail src (indexed by cursor before the click).
  // Fall back to DOM search only when not provided.
  const imageUrl = preImageUrl
    || pickBestImageUrl(Array.from(document.querySelectorAll('img[src*="googleusercontent.com"], img[src*="lh3.googleusercontent.com"]')));
  const coordinates = extractCoordinatesFromUrl(normalizedUrl);

  if (!coordinates && !imageUrl) {
    return null;
  }

  return {
    title: 'Contribución de Google Maps',
    text: 'Contribución de Google Maps',
    url: normalizedUrl,
    imageUrl: imageUrl || null,
    sourceUrl: window.location.href,
    coordinates,
    capturedAt: new Date().toISOString()
  };
};

const getNodeContributionUrlCandidates = (node) => {
  if (!node || !(node instanceof Element)) {
    return [];
  }

  const candidates = [];
  const ownHref = node.getAttribute('href') || '';
  const ownDataHref = node.getAttribute('data-href') || '';
  const closestLinkHref = node.closest('a[href]') ? node.closest('a[href]').getAttribute('href') || '' : '';
  const childLinkHref = node.querySelector('a[href]') ? node.querySelector('a[href]').getAttribute('href') || '' : '';

  for (const raw of [ownHref, ownDataHref, closestLinkHref, childLinkHref]) {
    const normalized = normalizeUrl(raw);
    if (normalized) {
      candidates.push(normalized);
    }
  }

  return candidates;
};

const findNextPhotoButton = () => {
  const candidates = Array.from(document.querySelectorAll('button, [role="button"]'));

  for (const candidate of candidates) {
    const label = safeText(candidate.textContent || candidate.getAttribute('aria-label') || '');
    if (/siguiente|next|sig\.|next photo|next photo/i.test(label)) {
      return candidate;
    }

    const name = candidate.getAttribute('aria-label') || candidate.getAttribute('title') || '';
    if (/siguiente|next/i.test(name)) {
      return candidate;
    }
  }

  return null;
};

const getMaxGalleryItems = (message = {}) => {
  const requested = Number(message.maxItems);
  if (Number.isFinite(requested) && requested > 0) {
    return Math.min(requested, 5000);
  }

  return Number.MAX_SAFE_INTEGER;
};

const nextPhotoInGallery = async (maxItems = Number.MAX_SAFE_INTEGER) => {
  const items = [];
  const seen = new Set();
  let noProgressCount = 0;

  const thumbnailSrcs = captureViewerThumbnailSrcs();

  for (let attempt = 0; attempt < 120 && items.length < maxItems; attempt += 1) {
    const galleryButtons = findGalleryPhotoButtons();
    if (!galleryButtons.length) {
      break;
    }

    if (galleryCursor >= galleryButtons.length) {
      break;
    }

    const button = galleryButtons[galleryCursor];
    const previousUrl = window.location.href;

    if (!button) {
      break;
    }

    const clickableTarget = button instanceof Element && button.tagName !== 'A'
      ? button.closest('button, [role="button"], a[href], [data-photo-bucket-iden]') || button
      : button;

    if (!clickableTarget || typeof clickableTarget.click !== 'function') {
      break;
    }

    const preImageUrl = thumbnailSrcs[galleryCursor] || null;
    const beforeCount = items.length;

    clickableTarget.scrollIntoView({ block: 'center', inline: 'center' });
    clickableTarget.click();

    const afterUrl = await waitForUrlChange(previousUrl, 12000);
    const fullUrl = await waitForFullContributionUrl(previousUrl, 12000);
    const finalUrl = await waitForUrlStable(5000, 1000);
    const buttonCandidates = getNodeContributionUrlCandidates(clickableTarget);
    const bestUrl = pickBestContributionUrl([fullUrl, finalUrl, afterUrl, ...buttonCandidates, previousUrl]) || finalUrl;
    const detailItem = collectCurrentDetailItem(bestUrl, preImageUrl);

    if (detailItem) {
      const key = `${detailItem.url.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        items.push(detailItem);
      }
    }

    galleryCursor += 1;

    if (afterUrl === previousUrl) {
      const fallbackNext = findNextPhotoButton();
      if (fallbackNext) {
        fallbackNext.scrollIntoView({ block: 'center', inline: 'center' });
        fallbackNext.click();
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
    }

    if (items.length === beforeCount) {
      noProgressCount += 1;
    } else {
      noProgressCount = 0;
    }

    if (galleryCursor >= galleryButtons.length || noProgressCount >= 6) {
      break;
    }

    if (items.length >= maxItems) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 800));
  }

  return items;
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
        resetGalleryCursor();

        if (/consent\.google\.com\//i.test(window.location.href) || /reject all|rechazar todo|accept all|aceptar todo/i.test(document.body?.innerText || '')) {
          await clickGoogleConsentButton();
          await new Promise((resolve) => setTimeout(resolve, 1600));
        }

        await scrollPageForResults();
        const maxItems = getMaxGalleryItems(message);
        const items = await nextPhotoInGallery(maxItems);
        const directItems = extractFromCurrentPage();
        const merged = items.length > 0 ? items : directItems;
        const deduped = [];
        const seen = new Set();

        for (const item of merged) {
          const key = `${(item.url || '').toLowerCase()}`;
          if (!seen.has(key)) {
            seen.add(key);
            deduped.push(item);
          }
        }

        sendResponse({ ok: true, items: deduped.slice(0, 200) });
      } catch (error) {
        sendResponse({ ok: false, error: String(error) });
      }
    })();

    return true;
  }

  return false;
});
