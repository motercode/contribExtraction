import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;
const OUTPUT_PATH = path.join(__dirname, 'contribuciones.json');
const LOG_PATH = path.join(__dirname, 'contribuciones_logs.jsonl');
const EMPTY_EXPORT = { total: 0, items: [] };
const MAX_RECENT_LOGS = 1000;

let recentLogs = [];

const ensureExportFile = () => {
  try {
    if (!fs.existsSync(OUTPUT_PATH)) {
      fs.writeFileSync(OUTPUT_PATH, JSON.stringify(EMPTY_EXPORT, null, 2), 'utf8');
    }
  } catch {
    // Ignorado: el archivo se recreará en la siguiente escritura.
  }
};

const ensureLogFile = () => {
  try {
    if (!fs.existsSync(LOG_PATH)) {
      fs.writeFileSync(LOG_PATH, '', 'utf8');
    }
  } catch {
    // Ignorado: el archivo se recreará en la siguiente escritura.
  }
};

const hydrateLogs = () => {
  ensureLogFile();

  try {
    const raw = fs.readFileSync(LOG_PATH, 'utf8').trim();
    if (!raw) {
      recentLogs = [];
      return;
    }

    recentLogs = raw
      .split(/\r?\n/)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .slice(-MAX_RECENT_LOGS);
  } catch {
    recentLogs = [];
  }
};

const normalizeLogEntry = (entry = {}) => {
  const timestamp = entry.timestamp || new Date().toISOString();
  const sessionId = String(entry.sessionId || '').trim() || null;
  const source = String(entry.source || 'extension').trim() || 'extension';
  const step = String(entry.step || entry.event || 'log').trim() || 'log';
  const message = entry.message === undefined || entry.message === null ? null : String(entry.message);
  const durationMs = Number(entry.durationMs);
  const elapsedMs = Number(entry.elapsedMs);

  return {
    timestamp,
    sessionId,
    source,
    step,
    message,
    data: entry.data ?? null,
    url: entry.url ? String(entry.url) : null,
    severity: String(entry.severity || 'info').trim() || 'info',
    durationMs: Number.isFinite(durationMs) ? durationMs : null,
    elapsedMs: Number.isFinite(elapsedMs) ? elapsedMs : null
  };
};

const appendLogEntry = (entry) => {
  const normalized = normalizeLogEntry(entry);
  const serialized = `${JSON.stringify(normalized)}\n`;

  ensureLogFile();
  fs.appendFileSync(LOG_PATH, serialized, 'utf8');

  recentLogs.push(normalized);
  if (recentLogs.length > MAX_RECENT_LOGS) {
    recentLogs = recentLogs.slice(-MAX_RECENT_LOGS);
  }

  const parts = [
    `[${normalized.timestamp}]`,
    normalized.sessionId ? `session=${normalized.sessionId}` : null,
    normalized.source ? `source=${normalized.source}` : null,
    normalized.step ? `step=${normalized.step}` : null,
    normalized.durationMs !== null ? `durationMs=${normalized.durationMs}` : null,
    normalized.elapsedMs !== null ? `elapsedMs=${normalized.elapsedMs}` : null,
    normalized.message ? `message=${normalized.message}` : null,
    normalized.data ? `data=${JSON.stringify(normalized.data)}` : null
  ].filter(Boolean);

  console.log(parts.join(' '));
  return normalized;
};

const readExportFile = () => {
  ensureExportFile();

  try {
    const raw = fs.readFileSync(OUTPUT_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return {
        total: parsed.length,
        items: parsed.map((item, index) => ({
          index: index + 1,
          url: String(item?.url || '').trim(),
          mapsUrlCanonical: String(item?.mapsUrlCanonical || '').trim() || null,
          imageUrl: item?.imageUrl ? String(item.imageUrl) : null,
          coordinates: item?.coordinates || null,
          capturedAt: item?.capturedAt || new Date().toISOString()
        }))
      };
    }

    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.items)) {
      const normalizedItems = parsed.items.map((item, index) => ({
        index: Number(item?.index) > 0 ? Number(item.index) : index + 1,
        url: String(item?.url || '').trim(),
        mapsUrlCanonical: String(item?.mapsUrlCanonical || '').trim() || null,
        imageUrl: item?.imageUrl ? String(item.imageUrl) : null,
        coordinates: item?.coordinates || null,
        capturedAt: item?.capturedAt || new Date().toISOString()
      }));

      return {
        total: normalizedItems.length,
        items: normalizedItems
      };
    }

    return { ...EMPTY_EXPORT };
  } catch {
    return { ...EMPTY_EXPORT };
  }
};

const normalizeItem = (item) => {
  const title = String(item?.title || 'Sin título').trim();
  const safeTitle = isGenericTitle(title) ? 'Contribución de Google Maps' : title || 'Sin título';
  const coordinates = item?.coordinates && typeof item.coordinates === 'object'
    ? {
        latitude: Number(item.coordinates.latitude),
        longitude: Number(item.coordinates.longitude)
      }
    : null;

  return {
    title: safeTitle.slice(0, 180),
    text: String(item?.text || safeTitle || 'Sin descripción disponible').slice(0, 500),
    url: String(item?.url || '').trim() || 'https://www.google.com/maps',
    mapsUrlCanonical: String(item?.mapsUrlCanonical || '').trim() || null,
    imageUrl: item?.imageUrl ? String(item.imageUrl) : null,
    sourceUrl: String(item?.sourceUrl || '').trim() || 'https://www.google.com/maps',
    coordinates: coordinates && Number.isFinite(coordinates.latitude) && Number.isFinite(coordinates.longitude) ? coordinates : null,
    capturedAt: item?.capturedAt || new Date().toISOString()
  };
};

const isGenericTitle = (title = '') => {
  if (!title) {
    return true;
  }

  return /^(foto|photo|image)\s+\d+\s+(de|of)\s+\d+$/i.test(title.trim())
    || /^(foto de perfil|sin t[ií]tulo|acciones de la foto|profile|perfil|avatar|ver m[aá]s)$/i.test(title.trim());
};

const isGoogleMetadataItem = (item = {}) => {
  const haystack = `${item?.title || ''} ${item?.url || ''} ${item?.imageUrl || ''}`.toLowerCase();

  if (!haystack) {
    return false;
  }

  return /accounts\.google\.com\/SignOutOptions|google\.com\/images\/branding\//i.test(haystack)
    || /cuenta de google|sign out|cerrar sesión|foto de perfil|acciones de la foto|sin título|profile photo/i.test(item?.title || '');
};

const dedupeItems = (items = []) => {
  const bestByKey = new Map();
  const filtered = [];

  for (const item of items) {
    const normalized = normalizeItem(item);
    const title = (normalized.title || '').trim();
    const url = (normalized.url || '').trim();
    const imageUrl = (normalized.imageUrl || '').trim();

    if (!url || url === 'https://www.google.com/maps') {
      continue;
    }

    const hasImage = Boolean(imageUrl);
    const isGeneric = isGenericTitle(title);

    if (isGoogleMetadataItem(normalized) || (isGeneric && !hasImage && !/\/maps\/.*(?:contrib|photo|photos|review|reviews)/i.test(url))) {
      continue;
    }

    if (!hasImage && !/\/maps\/.*(?:contrib|photo|photos|review|reviews)/i.test(url)) {
      continue;
    }

    const key = `${(imageUrl || url).toLowerCase()}|${(normalized.url || '').toLowerCase()}`;
    const current = bestByKey.get(key);

    if (!current) {
      bestByKey.set(key, normalized);
      continue;
    }

    const currentGeneric = isGenericTitle(current.title || '');
    if (!currentGeneric && isGeneric) {
      continue;
    }

    if (currentGeneric && !isGeneric) {
      bestByKey.set(key, normalized);
    }
  }

  for (const value of bestByKey.values()) {
    filtered.push(value);
  }

  return filtered.slice(0, 200);
};

const toExportItem = (item, index) => {
  const coordinates = item?.coordinates && typeof item.coordinates === 'object'
    ? {
        latitude: Number(item.coordinates.latitude),
        longitude: Number(item.coordinates.longitude)
      }
    : null;

  return {
    index: index + 1,
    url: String(item?.url || '').trim(),
    mapsUrlCanonical: String(item?.mapsUrlCanonical || '').trim() || null,
    imageUrl: item?.imageUrl ? String(item.imageUrl) : null,
    coordinates: coordinates && Number.isFinite(coordinates.latitude) && Number.isFinite(coordinates.longitude) ? coordinates : null,
    capturedAt: item?.capturedAt || new Date().toISOString()
  };
};

const buildExportPayload = (items = []) => {
  const dedupedItems = dedupeItems(items);
  const exportItems = dedupedItems.map((item, index) => toExportItem(item, index));
  return {
    total: exportItems.length,
    items: exportItems
  };
};

app.use(express.json({ limit: '2mb' }));
app.use(express.static(__dirname, { index: false }));
app.use('/public', express.static(path.join(__dirname, 'public')));

hydrateLogs();

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, status: 'ready' });
});

app.get('/api/export', (_req, res) => {
  const payload = readExportFile();
  res.json({ ok: true, total: payload.total, path: OUTPUT_PATH });
});

app.post('/api/save', (req, res) => {
  const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
  const payload = buildExportPayload(rawItems);

  ensureExportFile();
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2), 'utf8');

  res.json({ ok: true, total: payload.total, path: OUTPUT_PATH });
});

app.post('/api/log', (req, res) => {
  const entries = Array.isArray(req.body)
    ? req.body
    : Array.isArray(req.body?.entries)
      ? req.body.entries
      : [req.body];

  const normalized = entries
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => appendLogEntry(entry));

  res.json({ ok: true, accepted: normalized.length });
});

app.get('/api/logs', (req, res) => {
  const requestedLimit = Number(req.query.limit);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, MAX_RECENT_LOGS)
    : 200;
  const sessionId = String(req.query.sessionId || '').trim();

  const items = sessionId
    ? recentLogs.filter((entry) => entry.sessionId === sessionId)
    : recentLogs;

  res.json({
    ok: true,
    total: items.length,
    items: items.slice(-limit)
  });
});

app.get('/contribuciones.json', (_req, res) => {
  ensureExportFile();
  res.sendFile(OUTPUT_PATH);
});

app.delete('/', (_req, res) => {
  res.json({ ok: true, status: 'stopping' });
  setTimeout(() => process.exit(0), 150);
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Backend listo en http://localhost:${PORT}`);
});
