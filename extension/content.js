const SAFE_ORIGINS = ['google.com', 'maps.google.com'];

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

const extractFromCurrentPage = () => {
  const seen = new Set();
  const items = [];

  const nodes = Array.from(document.querySelectorAll('a[href], img, [role="link"], [role="article"], [data-photo-id], [data-review-id], [jsname]'));

  for (const node of nodes) {
    const href = node.href || node.getAttribute('href') || '';
    const aria = safeText(node.getAttribute('aria-label') || node.getAttribute('title'));
    const text = safeText(node.innerText || node.textContent || '');
    const imgNode = node.querySelector ? node.querySelector('img') : null;
    const imageUrl = imgNode ? imgNode.currentSrc || imgNode.src || imgNode.getAttribute('src') || '' : '';

    const candidateUrl = href ? normalizeUrl(href) : '';
    const combined = `${aria} ${text} ${candidateUrl} ${imageUrl}`.toLowerCase();

    if (!combined || combined.length < 25) {
      continue;
    }

    const isLikelyContrib = /contrib|review|photo|foto|photos|contribution|map|publicaci|valoraci/i.test(combined) || Boolean(imageUrl);
    if (!isLikelyContrib) {
      continue;
    }

    const url = candidateUrl || window.location.href;
    const key = `${url}|${imageUrl}|${text.slice(0, 80)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    items.push({
      title: (aria || text || 'Sin título').slice(0, 180),
      text: text || aria || 'Sin descripción disponible',
      url,
      imageUrl: imageUrl || null,
      sourceUrl: window.location.href,
      capturedAt: new Date().toISOString()
    });
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
