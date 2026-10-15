import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;
const OUTPUT_PATH = path.join(__dirname, 'contribuciones.json');
const BROWSER_PROFILE_DIR = path.join(__dirname, 'browser-profile');
const browserState = { browser: null, context: null, page: null };

const ensureBrowser = async () => {
  if (browserState.context) {
    return browserState.page || (await browserState.context.pages())[0];
  }

  fs.mkdirSync(BROWSER_PROFILE_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, {
    headless: process.env.PLAYWRIGHT_HEADLESS === 'true',
    viewport: { width: 1440, height: 1000 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    channel: 'chromium'
  });

  const page = (await context.pages()).length > 0 ? (await context.pages())[0] : await context.newPage();

  context.on('page', async (newPage) => {
    try {
      await newPage.waitForLoadState('domcontentloaded', { timeout: 15000 });
      await handleGoogleConsent(newPage);
    } catch {
      // Dejamos que el usuario controle los nuevos popups de Google si aparecen.
    }
  });

  browserState.browser = context.browser();
  browserState.context = context;
  browserState.page = page;

  return page;
};

const closeBrowser = async () => {
  if (browserState.page) {
    try {
      await browserState.page.close();
    } catch {}
    browserState.page = null;
  }

  if (browserState.context) {
    try {
      await browserState.context.close();
    } catch {}
    browserState.context = null;
  }

  if (browserState.browser) {
    try {
      await browserState.browser.close();
    } catch {}
    browserState.browser = null;
  }
};

const handleGoogleConsent = async (page) => {
  if (!page) {
    return false;
  }

  const selectors = [
    'button:has-text("Rechazar todo")',
    'button:has-text("Reject all")',
    'button:has-text("Aceptar todo")',
    'button:has-text("Accept all")',
    '[jsname="V67aGc"]',
    'text=Rechazar todo',
    'text=Reject all',
    'text=Aceptar todo',
    'text=Accept all'
  ];

  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      if ((await locator.count()) > 0) {
        await locator.click({ timeout: 10000 });
        await page.waitForTimeout(1200);
        return true;
      }
    } catch {
      // Si Google cambia el DOM, no bloqueamos el flujo manual del usuario.
    }
  }

  return false;
};

const normalizeUrl = (value) => {
  const input = String(value || '').trim();
  if (!input) {
    return null;
  }

  try {
    return new URL(input).toString();
  } catch {
    try {
      return new URL(`https://${input}`).toString();
    } catch {
      return null;
    }
  }
};

const safeText = (value) => {
  if (!value) {
    return '';
  }

  return String(value)
    .replace(/\s+/g, ' ')
    .trim();
};

const readExportFile = () => {
  try {
    if (!fs.existsSync(OUTPUT_PATH)) {
      fs.writeFileSync(OUTPUT_PATH, JSON.stringify([], null, 2));
    }
    const content = fs.readFileSync(OUTPUT_PATH, 'utf8');
    return JSON.parse(content);
  } catch {
    return [];
  }
};

async function autoScroll(page) {
  let previousHeight = 0;
  let noProgressCount = 0;

  for (let i = 0; i < 30; i += 1) {
    const currentHeight = await page.evaluate(() => {
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

      const target = findScrollableElement();
      const before = target.scrollTop;
      const delta = Math.max(800, target.clientHeight * 0.9);
      target.scrollTop = before + delta;

      return {
        after: target.scrollTop,
        height: target.scrollHeight,
        clientHeight: target.clientHeight,
        before
      };
    });

    await page.waitForTimeout(1500);

    const scrollReachedEnd = currentHeight.after <= currentHeight.before + 2 || currentHeight.height <= currentHeight.clientHeight + 2;
    if (scrollReachedEnd) {
      noProgressCount += 1;
    } else {
      noProgressCount = 0;
    }

    if (currentHeight.height <= previousHeight + 5) {
      noProgressCount += 1;
    }

    previousHeight = currentHeight.height;

    if (noProgressCount >= 4) {
      break;
    }
  }
}

async function collectContributions(page, targetUrl) {
  await autoScroll(page);

  const result = await page.evaluate((target) => {
    const safeText = (value) => {
      if (!value) {
        return '';
      }

      return String(value)
        .replace(/\s+/g, ' ')
        .trim();
    };

    const detectContributionCandidate = (node) => {
      if (!node) {
        return false;
      }

      const href = node.href || node.getAttribute('href') || '';
      const aria = safeText(node.getAttribute('aria-label') || node.getAttribute('title'));
      const text = safeText(node.innerText || node.textContent || '');
      const image = node.querySelector ? node.querySelector('img') : null;
      const imageUrl = image ? image.currentSrc || image.src || image.getAttribute('src') || '' : '';

      if (!href && !imageUrl && !text && !aria) {
        return false;
      }

      const combined = `${text} ${aria} ${href} ${imageUrl}`.toLowerCase();
      const looksLikeGoogleMapContent = /contrib|review|photo|maps|publicaci|valoraci|images?/i.test(combined);
      const hasImage = Boolean(imageUrl);
      const hasText = combined.length > 20;

      return looksLikeGoogleMapContent || (hasImage && hasText);
    };

    const seen = new Set();
    const entries = [];
    const allNodes = Array.from(document.querySelectorAll('a[href], [role="link"], [role="article"], [data-review-id], [data-photo-id], img'));

    for (const node of allNodes) {
      if (!detectContributionCandidate(node)) {
        continue;
      }

      const hrefNode = node.closest ? node.closest('a[href]') || node : node;
      const href = hrefNode.href || hrefNode.getAttribute('href') || '';
      let resolvedUrl = '';

      try {
        resolvedUrl = href ? new URL(href, document.baseURI).href : '';
      } catch {
        resolvedUrl = '';
      }

      const img = hrefNode.querySelector ? hrefNode.querySelector('img') || node.querySelector?.('img') || null : null;
      const imageUrl = img ? img.currentSrc || img.src || img.getAttribute('src') || '' : '';
      const label = safeText(hrefNode.getAttribute('aria-label') || hrefNode.getAttribute('title'));
      const text = safeText(hrefNode.innerText || hrefNode.textContent || '');
      const combinedText = [label, text].filter(Boolean).join(' ');

      if (!combinedText && !imageUrl && !resolvedUrl) {
        continue;
      }

      const key = `${resolvedUrl || ''}|${imageUrl || ''}|${combinedText.slice(0, 200)}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      entries.push({
        title: combinedText.slice(0, 180) || 'Sin título disponible',
        text: combinedText || 'Sin descripción disponible',
        url: resolvedUrl || target,
        imageUrl: imageUrl || null,
        sourceUrl: target,
        capturedAt: new Date().toISOString()
      });
    }

    return entries.slice(0, 200);
  }, targetUrl);

  return result;
}

app.use(express.json({ limit: '2mb' }));
app.use(express.static(__dirname, { index: false }));
app.use('/public', express.static(path.join(__dirname, 'public')));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, status: 'ready' });
});

app.get('/api/export', (_req, res) => {
  const payload = readExportFile();
  res.json({ ok: true, total: payload.length, path: OUTPUT_PATH });
});

app.get('/contribuciones.json', (_req, res) => {
  try {
    res.sendFile(OUTPUT_PATH);
  } catch {
    res.status(404).json({ error: 'Todavía no hay datos exportados.' });
  }
});

app.post('/api/open-browser', async (_req, res) => {
  try {
    await closeBrowser();
    const page = await ensureBrowser();
    await page.goto('https://www.google.com/maps', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await handleGoogleConsent(page);
    await page.waitForTimeout(2500);
    res.json({ ok: true, status: 'browser_opened', url: page.url() });
  } catch (error) {
    console.error('Error opening browser:', error);
    res.status(500).json({ ok: false, error: 'No se pudo abrir el navegador.' });
  }
});

app.post('/api/go-to-url', async (req, res) => {
  const targetUrl = normalizeUrl(req.body?.url || '');

  if (!targetUrl) {
    return res.status(400).json({ ok: false, error: 'Debes indicar una URL válida de Google Maps.' });
  }

  try {
    const page = await ensureBrowser();
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await handleGoogleConsent(page);
    await page.waitForTimeout(4000);
    res.json({ ok: true, status: 'page_loaded', url: page.url(), title: await page.title() });
  } catch (error) {
    console.error('Error loading URL:', error);
    res.status(500).json({ ok: false, error: 'No se pudo navegar a la URL indicada.' });
  }
});

app.post('/api/extract', async (req, res) => {
  const targetUrl = normalizeUrl(req.body?.url || '');

  if (!targetUrl) {
    return res.status(400).json({ ok: false, error: 'Debes indicar una URL válida de Google Maps.' });
  }

  try {
    const page = await ensureBrowser();
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await handleGoogleConsent(page);
    await page.waitForTimeout(5000);

    const contributions = await collectContributions(page, targetUrl);
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(contributions, null, 2), 'utf8');

    res.json({
      ok: true,
      total: contributions.length,
      exportPath: OUTPUT_PATH,
      url: page.url(),
      items: contributions.slice(0, 10)
    });
  } catch (error) {
    console.error('Error extracting contributions:', error);
    res.status(500).json({ ok: false, error: 'No se pudo extraer la información de la página.' });
  }
});

app.delete('/', async (_req, res) => {
  res.json({ ok: true, status: 'stopping' });
  setTimeout(async () => {
    await closeBrowser();
    process.exit(0);
  }, 200);
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

process.on('SIGINT', async () => {
  await closeBrowser();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closeBrowser();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`Servidor listo en http://localhost:${PORT}`);
});
