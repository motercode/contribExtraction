import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const PROFILE_URL = 'https://www.google.com/maps/contrib/102214896434264755474/photos';
const OUTPUT_PATH = path.join(ROOT_DIR, 'contribuciones_test.json');
const MAX_ITEMS = 10;

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Uso: npm run test:maps-11');
  console.log('Abre Google Maps en un navegador real, acepta Rechazar todo cuando aparezca y genera contribuciones Example.json con los 11 primeros elementos.');
  process.exit(0);
}

const safeText = (value = '') => String(value || '').replace(/\s+/g, ' ').trim();

const cleanImageUrl = (value = '') => {
  if (!value) {
    return '';
  }

  const match = String(value).match(/https?:\/\/[^\s"']+/i);
  return match ? match[0].replace(/&amp;/g, '&') : '';
};

const extractCoordinates = (url = '') => {
  const match = String(url).match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i);
  if (!match) {
    return null;
  }

  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { latitude, longitude };
};

const isLikelyGalleryNode = (node) => {
  if (!node) {
    return false;
  }

  const text = safeText(node.textContent || node.getAttribute('aria-label') || node.getAttribute('title') || '');
  const aria = safeText(node.getAttribute('aria-label') || '');
  const title = safeText(node.getAttribute('title') || '');
  const label = `${text} ${aria} ${title}`.trim();

  const hasPhotoCounter = /(foto|photo)\s+\d+\s+(de|of)\s+\d+/i.test(label);
  const hasPhotoWord = /(foto|photo)/i.test(label);
  const hasDataPhoto = !!node.getAttribute('data-photo-id') || !!node.getAttribute('data-review-id');
  const hasMapsLink = /\/maps\/.*(?:photo|photos|contrib)/i.test(node.href || node.getAttribute('href') || '');
  const isGoogleImage = node.tagName === 'IMG' && /googleusercontent\.com/i.test(node.currentSrc || node.src || '');

  return hasPhotoCounter || hasDataPhoto || hasMapsLink || (hasPhotoWord && (node.tagName === 'BUTTON' || node.tagName === 'A' || node.getAttribute('role') === 'button')) || isGoogleImage;
};

const findConsentButton = async (page) => {
  const selectors = [
    'button:has-text("Rechazar todo")',
    'button:has-text("Reject all")',
    '[role="button"]:has-text("Rechazar todo")',
    '[role="button"]:has-text("Reject all")',
    'span:has-text("Rechazar todo")',
    'span:has-text("Reject all")',
    'div:has-text("Rechazar todo")',
    'div:has-text("Reject all")'
  ];

  for (let attempt = 0; attempt < 30; attempt += 1) {
    for (const selector of selectors) {
      const candidate = page.locator(selector).first();
      if ((await candidate.count()) === 0) {
        continue;
      }

      await candidate.scrollIntoViewIfNeeded();
      await candidate.click({ force: true, timeout: 10000 });
      await page.waitForTimeout(1500);
      return true;
    }

    await page.waitForTimeout(500);
  }

  return false;
};

const waitForMapsProfile = async (page, timeoutMs = 60000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const url = page.url();
    try {
      const parsed = new URL(url);
      const isGoogleMaps = /(^|\.)google\.com$/i.test(parsed.hostname) || /^maps\.google\.com$/i.test(parsed.hostname);
      const isConsent = /consent\.google\.com/i.test(parsed.hostname);
      const isProfile = isGoogleMaps && !isConsent && /\/maps\/contrib\//i.test(url) && /\/photos/i.test(url);
      if (isProfile) {
        return url;
      }
      if (!isConsent && isGoogleMaps && /\/maps\//i.test(url) && /photos/i.test(url)) {
        return url;
      }
    } catch {
      // ignora URLs no válidas
    }

    if (await page.locator('body').count()) {
      const title = await page.title();
      if (/Google Maps/i.test(title)) {
        return url;
      }
    }
    await page.waitForTimeout(250);
  }

  return page.url();
};

const waitForUrlChange = async (page, previousUrl, timeoutMs = 15000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const currentUrl = page.url();
    if (currentUrl !== previousUrl) {
      return currentUrl;
    }
    await page.waitForTimeout(250);
  }

  return page.url();
};

// Waits until page.url() stops changing for `stableMs` ms, then returns it.
const waitForUrlStable = async (page, timeoutMs = 8000, stableMs = 1500) => {
  const startedAt = Date.now();
  let lastUrl = page.url();
  let lastChangeAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    await page.waitForTimeout(300);
    const current = page.url();
    if (current !== lastUrl) {
      lastUrl = current;
      lastChangeAt = Date.now();
    } else if (Date.now() - lastChangeAt >= stableMs) {
      return lastUrl;
    }
  }

  return page.url();
};

// Waits for the full photo-detail URL: changed from previousUrl AND has coordinates + /data=
const waitForPhotoDetailUrl = async (page, previousUrl, timeoutMs = 20000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const current = page.url();
    if (
      current !== previousUrl &&
      /@-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?/i.test(current) &&
      /\/data=/i.test(current)
    ) {
      return current;
    }
    await page.waitForTimeout(250);
  }
  return page.url();
};

const getViewerImageSrcs = (page) =>
  page.evaluate(() =>
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
      .filter((src) => /lh3\.googleusercontent\.com/i.test(src))
  );

const getBestImage = async (page, priorSrcs = []) => {
  // Wait for a NEW viewer image (not present before the click)
  try {
    await page.waitForFunction((prior) =>
      Array.from(document.querySelectorAll('img[decoding="async"]')).some((img) => {
        const style = img.getAttribute('style') || '';
        const src = (img.currentSrc || img.src || '').trim();
        return (
          /position\s*:\s*absolute/i.test(style) &&
          /top\s*:\s*50%/i.test(style) &&
          /left\s*:\s*50%/i.test(style) &&
          /lh3\.googleusercontent\.com/i.test(src) &&
          !prior.includes(src)
        );
      })
    , priorSrcs, { timeout: 8000 });
  } catch { /* timeout — fall through */ }

  // Return the last NEW viewer image (overlay is appended after thumbnails in the SPA DOM)
  const viewerSrc = await page.evaluate((prior) => {
    const matches = Array.from(document.querySelectorAll('img[decoding="async"]')).filter((img) => {
      const style = img.getAttribute('style') || '';
      const src = (img.currentSrc || img.src || '').trim();
      return (
        /position\s*:\s*absolute/i.test(style) &&
        /top\s*:\s*50%/i.test(style) &&
        /left\s*:\s*50%/i.test(style) &&
        /lh3\.googleusercontent\.com/i.test(src) &&
        !prior.includes(src)
      );
    });
    if (!matches.length) return null;
    const last = matches[matches.length - 1];
    return (last.currentSrc || last.src || '').trim();
  }, priorSrcs);

  if (viewerSrc) return cleanImageUrl(viewerSrc);

  // Fallback: extract image URL from the !6s parameter encoded in the page URL
  try {
    const match = page.url().match(/!6s(https?[^!]+)/);
    if (match) {
      const decoded = decodeURIComponent(match[1]).replace(/&amp;/g, '&');
      if (/lh3\.googleusercontent\.com/i.test(decoded)) return cleanImageUrl(decoded);
    }
  } catch { /* ignore */ }

  // Fallback: any gps-cs / gpms-cs googleusercontent image
  const images = page.locator('img');
  const total = await images.count();

  for (let index = 0; index < total; index += 1) {
    const image = images.nth(index);
    const src = cleanImageUrl(
      (await image.getAttribute('src')) ||
      (await image.getAttribute('data-src')) ||
      (await image.evaluate((el) => el.currentSrc || el.src || ''))
    );

    if (!src || !/googleusercontent\.com/i.test(src)) continue;
    if (/\/a-\//i.test(src) || /w72-h72|w144-h144|w96-h96|w48-h48/i.test(src)) continue;
    if (/gps-cs|gpms-cs/i.test(src)) return src;
  }

  for (let index = 0; index < total; index += 1) {
    const image = images.nth(index);
    const src = cleanImageUrl(
      (await image.getAttribute('src')) ||
      (await image.getAttribute('data-src')) ||
      (await image.evaluate((el) => el.currentSrc || el.src || ''))
    );

    if (!src || !/googleusercontent\.com/i.test(src)) continue;
    if (!/\/a-\//i.test(src) && !/w72-h72|w144-h144|w96-h96|w48-h48/i.test(src)) return src;
  }

  return null;
};

const getVisibleContributionImages = async (page) => {
  const result = await page.evaluate(() => {
    const images = Array.from(document.querySelectorAll('img')).filter((image) => {
      const src = (image.currentSrc || image.src || '').trim();
      return /googleusercontent\.com/i.test(src) && !/\/a-\//i.test(src) && !/w72-h72|w96-h96|w144-h144|w48-h48/i.test(src);
    });

    const unique = [];
    const seen = new Set();

    for (const image of images) {
      const src = (image.currentSrc || image.src || '').trim();
      if (!src || seen.has(src)) {
        continue;
      }

      const clickable = image.closest('a, button, [role="button"], [role="link"]') || image;
      seen.add(src);
      unique.push({
        src,
        tagName: clickable.tagName,
        aria: clickable.getAttribute('aria-label') || '',
        title: clickable.getAttribute('title') || '',
        index: unique.length,
      });
    }

    return unique.slice(0, 40);
  });

  return result;
};

const clickContributionImageByIndex = async (page, imageIndex) => {
  const result = await page.evaluate((targetIndex) => {
    const images = Array.from(document.querySelectorAll('img')).filter((image) => {
      const src = (image.currentSrc || image.src || '').trim();
      return /googleusercontent\.com/i.test(src) && !/\/a-\//i.test(src) && !/w72-h72|w96-h96|w144-h144|w48-h48/i.test(src);
    });

    const targetImage = images[targetIndex] || images[0];
    if (!targetImage) {
      return { ok: false, reason: 'No contribution image found' };
    }

    const target = targetImage.closest('a, button, [role="button"], [role="link"]') || targetImage;
    if (!target) {
      return { ok: false, reason: 'No clickable wrapper found for the image' };
    }

    target.scrollIntoView({ block: 'center', inline: 'center' });
    if (typeof target.click === 'function') {
      target.click();
    } else if (typeof targetImage.click === 'function') {
      targetImage.click();
    }

    return {
      ok: true,
      src: ((targetImage.currentSrc || targetImage.src || '').trim()),
    };
  }, imageIndex);

  return result;
};

async function main() {
  const browser = await chromium.launch({ headless: false, channel: 'chromium' });

  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    await page.goto(PROFILE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2000);

    if (page.url().includes('consent.google.com')) {
      console.log('CONSENT url before click:', page.url());
      const clicked = await findConsentButton(page);
      console.log('CONSENT click result:', clicked, 'after click url:', page.url());
      await page.waitForTimeout(2000);
      await waitForMapsProfile(page, 30000);
      console.log('PROFILE url after consent:', page.url());
    }

    await page.waitForTimeout(2500);

    // Scroll to load all available thumbnails before doing anything
    let loadAttempts = 0;
    while (loadAttempts < 8) {
      const current = await getVisibleContributionImages(page);
      if (current.length >= MAX_ITEMS) break;
      await page.evaluate(() => window.scrollBy(0, 600));
      await page.waitForTimeout(1000);
      loadAttempts += 1;
    }

    const imageSet = await getVisibleContributionImages(page);
    if (!imageSet.length) {
      const screenshotPath = path.join(ROOT_DIR, 'debug-gallery-empty.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log('No se encontraron imágenes de contribución visibles. Captura guardada en:', screenshotPath);
      const debug = await page.evaluate(() => ({
        url: location.href,
        title: document.title,
        bodySnippet: (document.body?.innerText || '').slice(0, 500),
        imageCount: document.querySelectorAll('img').length,
        buttonCount: document.querySelectorAll('button, [role="button"]').length,
      }));
      console.log(JSON.stringify(debug, null, 2));
      throw new Error('No se encontraron imágenes visibles para la galería de contribuciones.');
    }

    // Capture all thumbnail srcs upfront — one pass over the profile page, no navigation needed
    const allThumbnailSrcs = await getViewerImageSrcs(page);
    const total = Math.min(allThumbnailSrcs.length, MAX_ITEMS);
    console.log(`Thumbnails encontrados: ${allThumbnailSrcs.length} — capturando ${total}`);

    const items = [];
    const seen = new Set();

    // Replicates the extension's findGalleryPhotoButtons + nextPhotoInGallery logic:
    // Gallery buttons (aria-label "Foto N de M") stay in the SPA DOM after each click,
    // so we can keep clicking them by cursor index without ever going back.
    for (let cursor = 0; cursor < total; cursor += 1) {
      // Re-query gallery buttons each iteration (SPA may add/update them)
      const galleryButtons = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('button, [role="button"]'))
          .filter((btn) => {
            const label = (btn.getAttribute('aria-label') || btn.textContent || '').replace(/\s+/g, ' ').trim();
            return /foto\s+\d+\s+de\s+\d+|photo\s+\d+\s+of\s+\d+/i.test(label);
          })
          .map((btn) => btn.getAttribute('aria-label') || btn.textContent || '');
      });

      console.log(`[${cursor}] gallery buttons found: ${galleryButtons.length} — clicking index ${cursor}`);

      if (cursor >= galleryButtons.length) {
        console.log(`[${cursor}] no button at this index — stop`);
        break;
      }

      const previousUrl = page.url();

      // Click the gallery button at cursor position (same as extension's galleryCursor)
      await page.evaluate((idx) => {
        const buttons = Array.from(document.querySelectorAll('button, [role="button"]')).filter((btn) => {
          const label = (btn.getAttribute('aria-label') || btn.textContent || '').replace(/\s+/g, ' ').trim();
          return /foto\s+\d+\s+de\s+\d+|photo\s+\d+\s+of\s+\d+/i.test(label);
        });
        if (buttons[idx]) {
          buttons[idx].scrollIntoView({ block: 'center', inline: 'center' });
          buttons[idx].click();
        }
      }, cursor);

      await page.waitForTimeout(800);
      const currentUrl = await waitForUrlChange(page, previousUrl, 12000);
      const coordinates = extractCoordinates(currentUrl);

      if (!coordinates) {
        console.log(`[${cursor}] sin coordenadas — saltado`);
        continue;
      }

      await page.waitForTimeout(800);
      const finalUrl = await waitForUrlStable(page, 5000, 1000);
      const imageUrl = allThumbnailSrcs[cursor]
        ? cleanImageUrl(allThumbnailSrcs[cursor])
        : await getBestImage(page, allThumbnailSrcs);

      if (!seen.has(finalUrl)) {
        seen.add(finalUrl);
        items.push({
          index: items.length + 1,
          url: finalUrl,
          imageUrl,
          coordinates,
          capturedAt: new Date().toISOString(),
        });
        console.log(`[${cursor}] → item #${items.length} guardado`);
      }
    }

    const payload = { total: items.length, items };
    await fs.promises.writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    console.log(`Guardado ${items.length} elementos en ${OUTPUT_PATH}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
