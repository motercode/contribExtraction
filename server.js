import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toCanonicalMapsUrl, toStableThumbnailUrl } from './lib/maps-url.js';
import { datesPath, readDatesCache, takenAtFields } from './lib/taken-at.js';
import { exportGallery, galleryPath, parseGalleryBody, readGalleryRecords } from './lib/gallery.js';

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

app.use(express.json({ limit: '5mb' }));
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

// --- Fase 1: inventario incremental por perfil (harvest/<userId>.json) ---
const HARVEST_DIR = path.join(__dirname, 'harvest');

const harvestPath = (userId) => path.join(HARVEST_DIR, `${userId}.json`);

const isValidUserId = (userId) => /^\d+$/.test(String(userId || ''));

const readHarvest = (userId) => {
  try {
    return JSON.parse(fs.readFileSync(harvestPath(userId), 'utf8'));
  } catch {
    return { userId, profileTotal: null, total: 0, items: [] };
  }
};

app.post('/api/harvest', (req, res) => {
  const { userId, profileTotal, items } = req.body || {};
  if (!isValidUserId(userId) || !Array.isArray(items)) {
    return res.status(400).json({ ok: false, error: 'Se esperaba { userId, items[] }.' });
  }

  const current = readHarvest(userId);
  const byKey = new Map(current.items.map((item) => [item.key, item]));
  let added = 0;

  for (const item of items) {
    const key = String(item?.key || '').trim();
    if (!key) {
      continue;
    }

    const existing = byKey.get(key);
    if (!existing) {
      added += 1;
      byKey.set(key, { ...item, key });
      continue;
    }

    // Completa campos que antes faltaban, sin borrar los que ya había.
    for (const [field, value] of Object.entries(item)) {
      if (value !== null && value !== undefined && (existing[field] === null || existing[field] === undefined)) {
        existing[field] = value;
      }
    }
  }

  const merged = {
    userId,
    profileTotal: Number(profileTotal) || current.profileTotal || null,
    updatedAt: new Date().toISOString(),
    total: byKey.size,
    items: [...byKey.values()]
  };

  writeHarvest(userId, merged);
  res.json({ ok: true, added, total: merged.total, profileTotal: merged.profileTotal });
});

app.get('/api/harvest/:userId', (req, res) => {
  if (!isValidUserId(req.params.userId)) {
    return res.status(400).json({ ok: false, error: 'userId no válido.' });
  }

  const current = readHarvest(req.params.userId);
  res.json({
    ok: true,
    userId: current.userId,
    profileTotal: current.profileTotal,
    total: current.total,
    withCoordinates: current.items.filter((item) => item.coordinates).length,
    withUrl: current.items.filter((item) => item.url).length,
    withDetail: current.items.filter((item) => item.detailCapturedAt).length,
    updatedAt: current.updatedAt || null
  });
});

// --- Fase 2: coordenadas reales de cada foto, abriéndolas una a una ---
// Escritura atómica: si el proceso muere a mitad, el JSON anterior sigue intacto.
const writeHarvest = (userId, data) => {
  fs.mkdirSync(HARVEST_DIR, { recursive: true });
  const target = harvestPath(userId);
  const temp = `${target}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(temp, target);
};

const DETAIL_FIELDS = ['photoId', 'url', 'mapsUrlCanonical', 'coordinates', 'detailCapturedAt', 'takenAt', 'takenAtSource'];

app.post('/api/harvest/details', (req, res) => {
  const { userId, profileTotal, items } = req.body || {};
  if (!isValidUserId(userId) || !Array.isArray(items)) {
    return res.status(400).json({ ok: false, error: 'Se esperaba { userId, items[] }.' });
  }

  const current = readHarvest(userId);
  const byKey = new Map(current.items.map((item) => [item.key, item]));
  let updated = 0;
  let added = 0;

  for (const detail of items) {
    const key = String(detail?.key || '').trim();
    if (!key || !detail.coordinates || !detail.url) {
      continue;
    }

    let item = byKey.get(key);
    if (!item) {
      // Foto que no estaba en el inventario (p. ej. subida después): se añade.
      item = { key, position: null, bucketId: null, imageUrl: detail.imageUrl || null, capturedAt: detail.detailCapturedAt };
      byKey.set(key, item);
      added += 1;
    } else {
      updated += 1;
    }

    // Los datos de la fase 2 sustituyen a los de la fase 1 (que eran los de la página, no los de la foto).
    for (const field of DETAIL_FIELDS) {
      if (detail[field] !== undefined) {
        item[field] = detail[field];
      }
    }
  }

  const allItems = [...byKey.values()];
  const merged = {
    ...current,
    userId,
    profileTotal: Number(profileTotal) || current.profileTotal || null,
    updatedAt: new Date().toISOString(),
    total: allItems.length,
    items: allItems
  };

  writeHarvest(userId, merged);
  res.json({
    ok: true,
    updated,
    added,
    total: merged.total,
    withDetail: allItems.filter((item) => item.detailCapturedAt).length
  });
});

// Lo ya resuelto en la fase 2, para que la extensión se lo salte al retomar.
app.get('/api/harvest/:userId/done', (req, res) => {
  if (!isValidUserId(req.params.userId)) {
    return res.status(400).json({ ok: false, error: 'userId no válido.' });
  }

  const current = readHarvest(req.params.userId);
  const done = current.items.filter((item) => item.detailCapturedAt);
  res.json({
    ok: true,
    profileTotal: current.profileTotal,
    total: current.total,
    photoIds: done.map((item) => item.photoId).filter(Boolean),
    keys: done.map((item) => item.key)
  });
});

// Resultado de la fase 2 con el mismo formato que contribuciones.json.
app.get('/api/harvest/:userId/export', (req, res) => {
  if (!isValidUserId(req.params.userId)) {
    return res.status(400).json({ ok: false, error: 'userId no válido.' });
  }

  const done = readHarvest(req.params.userId).items.filter((item) => item.detailCapturedAt);
  const dates = readDatesCache(datesPath(HARVEST_DIR, req.params.userId));
  res.json({
    total: done.length,
    items: done.map((item, index) => ({
      index: index + 1,
      url: item.url,
      // myTravelsArround no admite null en los campos opcionales: se omiten.
      ...(item.url ? { mapsUrlCanonical: toCanonicalMapsUrl(item.url) } : {}),
      ...(item.imageUrl ? { imageUrl: toStableThumbnailUrl(item.imageUrl) } : {}),
      coordinates: item.coordinates,
      capturedAt: item.detailCapturedAt,
      ...takenAtFields(item, dates)
    }))
  });
});

// Muestras de las respuestas de red de Maps, para analizar si traen coordenadas.
app.post('/api/harvest/network', (req, res) => {
  const { userId, url, body } = req.body || {};
  if (!isValidUserId(userId) || typeof body !== 'string') {
    return res.status(400).json({ ok: false, error: 'Se esperaba { userId, url, body }.' });
  }

  fs.mkdirSync(HARVEST_DIR, { recursive: true });
  fs.appendFileSync(
    path.join(HARVEST_DIR, `${userId}.network.jsonl`),
    `${JSON.stringify({ ...req.body, url: String(url || '') })}\n`,
    'utf8'
  );
  res.json({ ok: true });
});

// --- Atajo: la galería completa pidiendo sus páginas, sin abrir fotos ---
// Una línea por página en harvest/<userId>.gallery.jsonl. reset: true (primera página de una
// recogida desde cero) vacía el archivo antes.
app.post('/api/shortcut/page', (req, res) => {
  const { userId, body, reset } = req.body || {};
  if (!isValidUserId(userId) || typeof body !== 'string') {
    return res.status(400).json({ ok: false, error: 'Se esperaba { userId, page, url, body }.' });
  }
  if (!parseGalleryBody(body)) {
    return res.status(400).json({ ok: false, error: 'El cuerpo no es una respuesta de la galería.' });
  }

  fs.mkdirSync(HARVEST_DIR, { recursive: true });
  const file = galleryPath(HARVEST_DIR, userId);
  const line = `${JSON.stringify({ ...req.body, reset: undefined })}\n`;
  if (reset) {
    fs.writeFileSync(file, line, 'utf8');
  } else {
    fs.appendFileSync(file, line, 'utf8');
  }
  res.json({ ok: true });
});

// Resultado del atajo con el mismo formato que contribuciones.json.
app.get('/api/shortcut/:userId/export', (req, res) => {
  const { userId } = req.params;
  if (!isValidUserId(userId)) {
    return res.status(400).json({ ok: false, error: 'userId no válido.' });
  }

  const { items } = exportGallery(readGalleryRecords(galleryPath(HARVEST_DIR, userId)), {
    userId,
    datesCache: readDatesCache(datesPath(HARVEST_DIR, userId))
  });
  res.json({ total: items.length, items });
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
