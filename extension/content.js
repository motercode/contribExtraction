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
const CONSENT_BUTTON_CLICK_DELAY_MS = 1400;
const CONSENT_BUTTON_RETRY_DELAY_MS = 300;
const CONSENT_POST_CLICK_DELAY_MS = 1600;
const URL_CHANGE_POLL_DELAY_MS = 250;
const URL_STABLE_POLL_DELAY_MS = 300;
const URL_STABLE_TIMEOUT_MS = 5000;
const URL_STABLE_WINDOW_MS = 1000;
const URL_CHANGE_TIMEOUT_MS = 12000;
const FULL_URL_RECOVERY_STEP_COUNT = 3;
const FULL_URL_RECOVERY_TIMEOUT_MS = 1500;
const GALLERY_FALLBACK_CLICK_DELAY_MS = 1200;
const GALLERY_ITEM_DELAY_MS = 800;
const SCROLL_STEP_DELAY_MS = 1200;
const SCROLL_INITIAL_STEP_PX = 700;
const SCROLL_NO_PROGRESS_LIMIT = 4;
const GALLERY_NO_PROGRESS_LIMIT = 6;
const GALLERY_MAX_ATTEMPTS = 120;

const EXTRACTION_CONFIG_DEFAULTS = {
  maxItems: 200,
  consentButtonClickDelayMs: CONSENT_BUTTON_CLICK_DELAY_MS,
  consentButtonRetryDelayMs: CONSENT_BUTTON_RETRY_DELAY_MS,
  consentPostClickDelayMs: CONSENT_POST_CLICK_DELAY_MS,
  urlChangePollDelayMs: URL_CHANGE_POLL_DELAY_MS,
  urlStablePollDelayMs: URL_STABLE_POLL_DELAY_MS,
  urlStableTimeoutMs: URL_STABLE_TIMEOUT_MS,
  urlStableWindowMs: URL_STABLE_WINDOW_MS,
  urlChangeTimeoutMs: URL_CHANGE_TIMEOUT_MS,
  galleryFallbackClickDelayMs: GALLERY_FALLBACK_CLICK_DELAY_MS,
  galleryItemDelayMs: GALLERY_ITEM_DELAY_MS,
  scrollStepDelayMs: SCROLL_STEP_DELAY_MS,
  scrollInitialStepPx: SCROLL_INITIAL_STEP_PX,
  scrollNoProgressLimit: SCROLL_NO_PROGRESS_LIMIT,
  galleryNoProgressLimit: GALLERY_NO_PROGRESS_LIMIT,
  galleryMaxAttempts: GALLERY_MAX_ATTEMPTS
};

let activeExtractionConfig = { ...EXTRACTION_CONFIG_DEFAULTS };
let activeExtractionSessionId = null;
let activeExtractionStartedAt = 0;

const toFiniteNumber = (value, fallback, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
};

const buildExtractionConfig = (overrides = {}) => ({
  maxItems: toFiniteNumber(overrides.maxItems, EXTRACTION_CONFIG_DEFAULTS.maxItems, 1, 5000),
  consentButtonClickDelayMs: toFiniteNumber(overrides.consentButtonClickDelayMs, EXTRACTION_CONFIG_DEFAULTS.consentButtonClickDelayMs, 0, 30000),
  consentButtonRetryDelayMs: toFiniteNumber(overrides.consentButtonRetryDelayMs, EXTRACTION_CONFIG_DEFAULTS.consentButtonRetryDelayMs, 0, 10000),
  consentPostClickDelayMs: toFiniteNumber(overrides.consentPostClickDelayMs, EXTRACTION_CONFIG_DEFAULTS.consentPostClickDelayMs, 0, 30000),
  urlChangePollDelayMs: toFiniteNumber(overrides.urlChangePollDelayMs, EXTRACTION_CONFIG_DEFAULTS.urlChangePollDelayMs, 0, 5000),
  urlStablePollDelayMs: toFiniteNumber(overrides.urlStablePollDelayMs, EXTRACTION_CONFIG_DEFAULTS.urlStablePollDelayMs, 0, 5000),
  urlStableTimeoutMs: toFiniteNumber(overrides.urlStableTimeoutMs, EXTRACTION_CONFIG_DEFAULTS.urlStableTimeoutMs, 100, 60000),
  urlStableWindowMs: toFiniteNumber(overrides.urlStableWindowMs, EXTRACTION_CONFIG_DEFAULTS.urlStableWindowMs, 0, 20000),
  urlChangeTimeoutMs: toFiniteNumber(overrides.urlChangeTimeoutMs, EXTRACTION_CONFIG_DEFAULTS.urlChangeTimeoutMs, 100, 60000),
  galleryFallbackClickDelayMs: toFiniteNumber(overrides.galleryFallbackClickDelayMs, EXTRACTION_CONFIG_DEFAULTS.galleryFallbackClickDelayMs, 0, 30000),
  galleryItemDelayMs: toFiniteNumber(overrides.galleryItemDelayMs, EXTRACTION_CONFIG_DEFAULTS.galleryItemDelayMs, 0, 30000),
  scrollStepDelayMs: toFiniteNumber(overrides.scrollStepDelayMs, EXTRACTION_CONFIG_DEFAULTS.scrollStepDelayMs, 0, 30000),
  scrollInitialStepPx: toFiniteNumber(overrides.scrollInitialStepPx, EXTRACTION_CONFIG_DEFAULTS.scrollInitialStepPx, 100, 10000),
  scrollNoProgressLimit: toFiniteNumber(overrides.scrollNoProgressLimit, EXTRACTION_CONFIG_DEFAULTS.scrollNoProgressLimit, 1, 20),
  galleryNoProgressLimit: toFiniteNumber(overrides.galleryNoProgressLimit, EXTRACTION_CONFIG_DEFAULTS.galleryNoProgressLimit, 1, 20),
  galleryMaxAttempts: toFiniteNumber(overrides.galleryMaxAttempts, EXTRACTION_CONFIG_DEFAULTS.galleryMaxAttempts, 1, 5000)
});

const setActiveExtractionConfig = (overrides = {}) => {
  activeExtractionConfig = buildExtractionConfig(overrides);
  return activeExtractionConfig;
};

const getActiveExtractionConfig = () => activeExtractionConfig;

const emitSlowStepLog = (step, data = {}) => {
  emitProcessLog(step, data, 'warn');
};

const emitProcessLog = (step, data = {}, severity = 'info') => {
  try {
    chrome.runtime.sendMessage(
      {
        type: 'LOG_EVENT',
        payload: {
          source: 'content',
          sessionId: activeExtractionSessionId,
          step,
          severity,
          timestamp: new Date().toISOString(),
          elapsedMs: activeExtractionStartedAt ? Date.now() - activeExtractionStartedAt : null,
          data
        }
      },
      () => void chrome.runtime.lastError
    );
  } catch {
    // Logging must never interrupt extraction.
  }
};

const isGoogleMapsPage = () => {
  const url = window.location.href || '';
  const isConsentPage = /consent\.google\.com\//i.test(url) || /continue=.*maps/i.test(url);
  return SAFE_ORIGINS.some((origin) => url.includes(origin)) && (url.includes('/maps') || isConsentPage || url.includes('google.com'));
};

const clickGoogleConsentButton = async () => {
  const config = getActiveExtractionConfig();
  const maxAttempts = 20;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const consentNode = Array.from(document.querySelectorAll('button, [role="button"], a, div, span')).find((node) => {
      const text = safeText(node.textContent || node.getAttribute('aria-label') || node.getAttribute('title') || '');
      return /rechazar todo|reject all|aceptar todo|accept all/i.test(text);
    });

    if (consentNode) {
      consentNode.click();
      await new Promise((resolve) => setTimeout(resolve, config.consentButtonClickDelayMs));
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, config.consentButtonRetryDelayMs));
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

const toCanonicalMapsUrl = (value = '') => {
  let url = String(value || '').trim();
  if (!url) {
    return '';
  }

  url = url.replace(
    /https:\/\/www\.google\.com\/maps\/contrib\/\d+\/photos\//i,
    'https://www.google.com/maps/'
  );
  url = url.replace(/,(-?\d+(?:\.\d+)?)r\//i, '/');

  const queryIndex = url.indexOf('?');
  const base = queryIndex >= 0 ? url.slice(0, queryIndex) : url;
  const query = queryIndex >= 0 ? url.slice(queryIndex) : '';
  const dataMatch = base.match(/^(.*\/data=)(.*)$/i);
  if (!dataMatch) {
    return url;
  }

  const dataPrefix = dataMatch[1];
  let dataPayload = dataMatch[2];

  dataPayload = dataPayload.replace(/!4m3!8m2!3m1!1e1$/i, '');
  dataPayload = dataPayload.replace(/^!3m7!1e1!3m5!/i, '!3m8!1e1!3m6!');
  if (!/!3e\d+!/i.test(dataPayload)) {
    dataPayload = dataPayload.replace(/(!2e10)(!)/i, '$1!3e11$2');
  }

  return `${dataPrefix}${dataPayload}${query}`;
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
      mapsUrlCanonical: toCanonicalMapsUrl(url),
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

const waitForUrlChange = async (previousUrl, timeoutMs = getActiveExtractionConfig().urlChangeTimeoutMs) => {
  const config = getActiveExtractionConfig();
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (window.location.href !== previousUrl) {
      return window.location.href;
    }
    await new Promise((resolve) => setTimeout(resolve, config.urlChangePollDelayMs));
  }

  return window.location.href;
};

// Waits until window.location.href stops changing for stableMs, then returns it.
const waitForUrlStable = async (timeoutMs = getActiveExtractionConfig().urlStableTimeoutMs, stableMs = getActiveExtractionConfig().urlStableWindowMs) => {
  const config = getActiveExtractionConfig();
  const startedAt = Date.now();
  let lastUrl = window.location.href;
  let lastChangeAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, config.urlStablePollDelayMs));
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

const waitForFullContributionUrl = async (previousUrl, timeoutMs = getActiveExtractionConfig().urlChangeTimeoutMs) => {
  const config = getActiveExtractionConfig();
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const current = window.location.href;
    if (current !== previousUrl && isFullContributionDetailUrl(current)) {
      return current;
    }
    await new Promise((resolve) => setTimeout(resolve, config.urlChangePollDelayMs));
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
    mapsUrlCanonical: toCanonicalMapsUrl(normalizedUrl),
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
  const requested = Number(message.maxItems ?? message.config?.maxItems);
  if (Number.isFinite(requested) && requested > 0) {
    return Math.min(requested, 5000);
  }

  return getActiveExtractionConfig().maxItems;
};

const summarizeNodeForLog = (node) => {
  if (!node) {
    return null;
  }

  const tagName = node.tagName || null;
  const ariaLabel = safeText(node.getAttribute?.('aria-label') || '');
  const title = safeText(node.getAttribute?.('title') || '');
  const text = safeText(node.textContent || '');
  const href = node.getAttribute?.('href') || node.href || null;
  const dataPhotoBucketIden = node.getAttribute?.('data-photo-bucket-iden') || null;
  const dataPhotoId = node.getAttribute?.('data-photo-id') || null;
  const dataReviewId = node.getAttribute?.('data-review-id') || null;

  return {
    tagName,
    ariaLabel: ariaLabel || null,
    title: title || null,
    text: text ? text.slice(0, 120) : null,
    href: href ? String(href).slice(0, 240) : null,
    dataPhotoBucketIden,
    dataPhotoId,
    dataReviewId
  };
};

const nextPhotoInGallery = async (maxItems = Number.MAX_SAFE_INTEGER) => {
  const config = getActiveExtractionConfig();
  const items = [];
  const seen = new Set();
  let noProgressCount = 0;
  let recoveryModeStepsRemaining = 0;

  const thumbnailSrcs = captureViewerThumbnailSrcs();
  emitProcessLog('gallery_started', {
    maxItems,
    galleryMaxAttempts: config.galleryMaxAttempts,
    galleryNoProgressLimit: config.galleryNoProgressLimit
  });

  for (let attempt = 0; attempt < config.galleryMaxAttempts && items.length < maxItems; attempt += 1) {
    const galleryButtons = findGalleryPhotoButtons();
    if (!galleryButtons.length) {
      emitProcessLog('gallery_stopped_no_buttons', { attempt });
      break;
    }

    if (galleryCursor >= galleryButtons.length) {
      emitProcessLog('gallery_stopped_cursor_limit', { attempt, galleryCursor, buttonCount: galleryButtons.length });
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
    const stepStartedAt = Date.now();
    const timingMode = recoveryModeStepsRemaining > 0 ? 'recovery' : 'normal';
    const fullUrlTimeoutMs = recoveryModeStepsRemaining > 0 ? FULL_URL_RECOVERY_TIMEOUT_MS : config.urlChangeTimeoutMs;
    const targetSummary = summarizeNodeForLog(clickableTarget);

    if (recoveryModeStepsRemaining > 0) {
      recoveryModeStepsRemaining -= 1;
    }

    emitProcessLog('gallery_step_start', {
      attempt,
      galleryCursor,
      timingMode,
      recoveryModeStepsRemaining,
      maxItems,
      buttonCount: galleryButtons.length,
      noProgressCount,
      previousUrl,
      preImageUrl: preImageUrl || null,
      target: targetSummary
    });

    clickableTarget.scrollIntoView({ block: 'center', inline: 'center' });
    emitProcessLog('gallery_click_dispatched', {
      attempt,
      galleryCursor,
      timingMode,
      recoveryModeStepsRemaining,
      target: targetSummary,
      preClickUrl: window.location.href
    });
    clickableTarget.click();

    const urlChangeStartedAt = Date.now();
    const changedUrl = await waitForUrlChange(previousUrl, config.urlChangeTimeoutMs);
    const urlChangeElapsedMs = Date.now() - urlChangeStartedAt;
    const urlChangeSucceeded = Boolean(changedUrl && changedUrl !== previousUrl);

    const fullUrlStartedAt = Date.now();
    const fullContributionUrl = await waitForFullContributionUrl(previousUrl, fullUrlTimeoutMs);
    const fullUrlElapsedMs = Date.now() - fullUrlStartedAt;
    const fullUrlSucceeded = Boolean(fullContributionUrl);

    const urlStableStartedAt = Date.now();
    const stableUrl = await waitForUrlStable(config.urlStableTimeoutMs, config.urlStableWindowMs);
    const urlStableElapsedMs = Date.now() - urlStableStartedAt;

    const finalUrl = window.location.href;
    const finalUrlChanged = finalUrl !== previousUrl;
    const buttonCandidates = getNodeContributionUrlCandidates(clickableTarget);
    const bestUrl = pickBestContributionUrl([finalUrl, ...buttonCandidates, previousUrl]) || finalUrl;
    const detailItem = collectCurrentDetailItem(bestUrl, preImageUrl);

    emitProcessLog('gallery_wait_summary', {
      attempt,
      galleryCursor,
      timingMode,
      recoveryModeStepsRemaining,
      fullUrlTimeoutMs,
      previousUrl,
      changedUrl: changedUrl || null,
      fullContributionUrl: fullContributionUrl || null,
      stableUrl: stableUrl || null,
      finalUrl,
      urlChangeSucceeded,
      fullUrlSucceeded,
      finalUrlChanged,
      urlChangeElapsedMs,
      fullUrlElapsedMs,
      urlStableElapsedMs,
      target: targetSummary,
      preImageUrl: preImageUrl || null,
      detailItemCaptured: Boolean(detailItem)
    });

    const slowSignals = [];
    if (urlChangeElapsedMs >= Math.max(3000, config.urlChangeTimeoutMs * 0.7)) {
      slowSignals.push('url_change_wait_slow');
    }
    if (fullUrlElapsedMs >= Math.max(3000, config.urlChangeTimeoutMs * 0.7)) {
      slowSignals.push('full_url_wait_slow');
    }
    if (urlStableElapsedMs >= Math.max(1500, config.urlStableTimeoutMs * 0.5)) {
      slowSignals.push('url_stable_wait_slow');
    }
    if (!finalUrlChanged) {
      slowSignals.push('url_not_changed_after_click');
    }
    if (!detailItem) {
      slowSignals.push('detail_item_missing');
    }

    if (detailItem) {
      const key = `${detailItem.url.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        items.push(detailItem);
      }
    }

    galleryCursor += 1;

    if (finalUrl === previousUrl) {
      const fallbackNext = findNextPhotoButton();
      if (fallbackNext) {
        emitProcessLog('gallery_fallback_click', {
          attempt,
          galleryCursor,
          timingMode,
          fallbackTarget: summarizeNodeForLog(fallbackNext),
          reason: 'final_url_unchanged'
        });
        fallbackNext.scrollIntoView({ block: 'center', inline: 'center' });
        fallbackNext.click();
        await new Promise((resolve) => setTimeout(resolve, config.galleryFallbackClickDelayMs));
      }
    }

    emitProcessLog('gallery_step_finished', {
      attempt,
      galleryCursor,
      itemCaptured: Boolean(detailItem),
      itemsCollected: items.length,
      urlChangeElapsedMs,
      fullUrlElapsedMs,
      urlStableElapsedMs,
      stepElapsedMs: Date.now() - stepStartedAt,
      finalUrlChanged,
      hasPreImage: Boolean(preImageUrl)
    });

    if (slowSignals.length) {
      emitSlowStepLog('gallery_step_slow', {
        attempt,
        galleryCursor,
        timingMode,
        recoveryModeStepsRemaining,
        fullUrlTimeoutMs,
        slowSignals,
        urlChangeElapsedMs,
        fullUrlElapsedMs,
        urlStableElapsedMs,
        stepElapsedMs: Date.now() - stepStartedAt,
        finalUrlChanged,
        previousUrl,
        finalUrl,
        hasPreImage: Boolean(preImageUrl)
      });

      if (slowSignals.includes('full_url_wait_slow')) {
        recoveryModeStepsRemaining = FULL_URL_RECOVERY_STEP_COUNT;
      }
    }

    if (items.length === beforeCount) {
      noProgressCount += 1;
    } else {
      noProgressCount = 0;
    }

    if (galleryCursor >= galleryButtons.length || noProgressCount >= config.galleryNoProgressLimit) {
      break;
    }

    if (items.length >= maxItems) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, config.galleryItemDelayMs));
  }

  emitProcessLog('gallery_finished', { itemsCollected: items.length, galleryCursor });
  return items;
};

const scrollPageForResults = async () => {
  const config = getActiveExtractionConfig();
  const target = findScrollableElement();
  let previous = 0;
  let noProgress = 0;
  let stepsRun = 0;

  emitProcessLog('scroll_started', {
    scrollInitialStepPx: config.scrollInitialStepPx,
    scrollStepDelayMs: config.scrollStepDelayMs,
    scrollNoProgressLimit: config.scrollNoProgressLimit,
    targetTag: target?.tagName || null
  });

  for (let step = 0; step < 24; step += 1) {
    const before = target.scrollTop || 0;
    const delta = Math.max(config.scrollInitialStepPx, target.clientHeight || 800);
    target.scrollTop = before + delta;
    await new Promise((resolve) => setTimeout(resolve, config.scrollStepDelayMs));
    stepsRun += 1;

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

    if (noProgress >= config.scrollNoProgressLimit) {
      break;
    }
  }

  emitProcessLog('scroll_finished', {
    stepsRun,
    finalScrollTop: target.scrollTop || 0,
    finalScrollHeight: target.scrollHeight || 0,
    noProgressCount: noProgress
  });

  return {
    stepsRun,
    noProgressCount: noProgress,
    finalScrollTop: target.scrollTop || 0,
    finalScrollHeight: target.scrollHeight || 0
  };
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isGoogleMapsPage()) {
    sendResponse({ ok: false, error: 'Abre una página de Google Maps antes de extraer contribuciones.' });
    return;
  }

  if (message.type === 'EXTRACT_CONTRIBUTIONS') {
    (async () => {
      const previousConfig = getActiveExtractionConfig();
      setActiveExtractionConfig(message.config || {});
      activeExtractionSessionId = String(message.config?.sessionId || `session-${Date.now()}`);
      activeExtractionStartedAt = Date.now();

      try {
        resetGalleryCursor();
        emitProcessLog('extraction_started', {
          url: window.location.href,
          config: getActiveExtractionConfig(),
          isConsentPage: /consent\.google\.com\//i.test(window.location.href)
        });

        if (/consent\.google\.com\//i.test(window.location.href) || /reject all|rechazar todo|accept all|aceptar todo/i.test(document.body?.innerText || '')) {
          emitProcessLog('consent_flow_detected', {});
          const consentStartedAt = Date.now();
          await clickGoogleConsentButton();
          const consentClickElapsedMs = Date.now() - consentStartedAt;
          emitProcessLog('consent_flow_completed', { consentClickElapsedMs });
          await new Promise((resolve) => setTimeout(resolve, getActiveExtractionConfig().consentPostClickDelayMs));
        }

        const scrollStats = await scrollPageForResults();
        const maxItems = getMaxGalleryItems(message);
        emitProcessLog('gallery_phase_prepared', { maxItems, scrollStats });
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

        emitProcessLog('extraction_completed', {
          galleryItems: items.length,
          directItems: directItems.length,
          mergedItems: merged.length,
          dedupedItems: deduped.length,
          outputItems: Math.min(deduped.length, maxItems)
        });
        sendResponse({ ok: true, items: deduped.slice(0, maxItems) });
      } catch (error) {
        emitProcessLog('extraction_failed', { error: String(error) }, 'error');
        sendResponse({ ok: false, error: String(error) });
      } finally {
        activeExtractionConfig = previousConfig;
        activeExtractionSessionId = null;
        activeExtractionStartedAt = 0;
      }
    })();

    return true;
  }

  return false;
});
