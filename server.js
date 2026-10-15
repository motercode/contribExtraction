import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;
const OUTPUT_PATH = path.join(__dirname, 'contribuciones.json');

const ensureExportFile = () => {
  try {
    if (!fs.existsSync(OUTPUT_PATH)) {
      fs.writeFileSync(OUTPUT_PATH, JSON.stringify([], null, 2), 'utf8');
    }
  } catch {
    // Ignorado: el archivo se recreará en la siguiente escritura.
  }
};

const readExportFile = () => {
  ensureExportFile();

  try {
    const raw = fs.readFileSync(OUTPUT_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const normalizeItem = (item) => {
  const title = String(item?.title || 'Sin título').trim();
  const safeTitle = isGenericTitle(title) ? 'Contribución de Google Maps' : title || 'Sin título';

  return {
    title: safeTitle.slice(0, 180),
    text: String(item?.text || safeTitle || 'Sin descripción disponible').slice(0, 500),
    url: String(item?.url || '').trim() || 'https://www.google.com/maps',
    imageUrl: item?.imageUrl ? String(item.imageUrl) : null,
    sourceUrl: String(item?.sourceUrl || '').trim() || 'https://www.google.com/maps',
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

    const key = (imageUrl || url).toLowerCase();
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

app.post('/api/save', (req, res) => {
  const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
  const payload = dedupeItems(rawItems);

  ensureExportFile();
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2), 'utf8');

  res.json({ ok: true, total: payload.length, path: OUTPUT_PATH });
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
