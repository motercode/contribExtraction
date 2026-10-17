// Exporta las fotos ya resueltas en la fase 2 (harvest/<userId>.json) con el formato
// de contribuciones.json que lee myTravelsArround.
//
//   node scripts/export-harvest.js <userId> [salida.json] [--dates] [--retry-missing]
//
// Por defecto escribe harvest/<userId>.export.json. No hace falta tener el backend arrancado.
//
// --dates: antes de exportar completa la fecha de captura (takenAt) de las fotos que aún no la
//   tienen, leyendo el EXIF del original una a una con 1 s ± 0,5 s de pausa. Se guarda en
//   harvest/<userId>.dates.json cada pocas fotos: se puede cortar con Ctrl+C y retomar.
// --retry-missing: vuelve a pedir también las que la otra vez no tenían EXIF.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toCanonicalMapsUrl, toStableThumbnailUrl } from '../lib/maps-url.js';
import { datesPath, fetchExifTakenAt, readDatesCache, readPhotometaDates, takenAtFields, writeDatesCache } from '../lib/taken-at.js';

const DATES_DELAY_MS = 1000;
const DATES_JITTER_MS = 500;
const DATES_SAVE_EVERY = 20;
const DATES_MAX_CONSECUTIVE_ERRORS = 5;

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const harvestDir = path.join(root, 'harvest');
const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith('--')));
const [userId, outArg] = args.filter((arg) => !arg.startsWith('--'));

if (!/^\d+$/.test(String(userId || ''))) {
  console.error('Uso: node scripts/export-harvest.js <userId> [salida.json] [--dates] [--retry-missing]');
  process.exit(1);
}

const harvest = JSON.parse(fs.readFileSync(path.join(harvestDir, `${userId}.json`), 'utf8'));
const seenPhotoIds = new Set();
const exportable = [];

for (const item of harvest.items) {
  if (!item.detailCapturedAt || !item.coordinates || !item.url || seenPhotoIds.has(item.photoId)) {
    continue;
  }
  seenPhotoIds.add(item.photoId);
  exportable.push(item);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const completeDates = async (cache, cacheFile) => {
  const pending = exportable.filter((item) => {
    if (item.takenAt) return false;
    const cached = cache.items[item.key];
    return !cached || (flags.has('--retry-missing') && cached.source !== 'exif');
  });
  if (pending.length === 0) {
    console.log('Fechas: todas las fotos exportables ya la tienen.');
    return;
  }

  const photometa = readPhotometaDates(path.join(harvestDir, `${userId}.network.jsonl`));
  const counts = { exif: 0, photometa: 0, none: 0 };
  let interrupted = false;
  let consecutiveErrors = 0;
  let sinceSave = 0;
  process.on('SIGINT', () => {
    interrupted = true;
    console.log('\nDeteniendo… se guarda lo que hay.');
  });

  console.log(`Fechas: ${pending.length} pendientes (~${Math.ceil((pending.length * (DATES_DELAY_MS + 500)) / 60000)} min). Ctrl+C para parar y retomar luego.`);

  for (const [index, item] of pending.entries()) {
    if (interrupted) break;

    try {
      const { takenAt } = await fetchExifTakenAt(item.key);
      consecutiveErrors = 0;
      const dayOnly = photometa.get(String(item.photoId || '').replace(/^\d+:/, ''));
      const entry = takenAt
        ? { takenAt, source: 'exif' }
        : dayOnly
          ? { takenAt: dayOnly, source: 'photometa' }
          : { takenAt: null, source: 'none' };
      cache.items[item.key] = { ...entry, checkedAt: new Date().toISOString() };
      counts[entry.source] += 1;
      sinceSave += 1;
    } catch (error) {
      // Pasajero (red, 429, 5xx): no se guarda, se reintenta en la próxima ejecución.
      consecutiveErrors += 1;
      console.warn(`  [${index + 1}/${pending.length}] ${item.photoId || item.key}: ${error.message}`);
      if (consecutiveErrors >= DATES_MAX_CONSECUTIVE_ERRORS) {
        console.warn(`Fechas: ${DATES_MAX_CONSECUTIVE_ERRORS} errores seguidos, se para (¿Google limitando?). Vuelve a lanzarlo más tarde.`);
        break;
      }
    }

    if (sinceSave >= DATES_SAVE_EVERY) {
      writeDatesCache(cacheFile, cache);
      sinceSave = 0;
    }
    if ((index + 1) % 25 === 0) {
      console.log(`  ${index + 1}/${pending.length} · exif ${counts.exif} · solo día ${counts.photometa} · sin fecha ${counts.none}`);
    }
    if (index < pending.length - 1 && !interrupted) {
      // Cadencia irregular: 0,5–1,5 s entre peticiones.
      await sleep(DATES_DELAY_MS + (Math.random() * 2 - 1) * DATES_JITTER_MS);
    }
  }

  writeDatesCache(cacheFile, cache);
  console.log(`Fechas: exif ${counts.exif} · solo día ${counts.photometa} · sin fecha ${counts.none}`);
};

const cacheFile = datesPath(harvestDir, userId);
const cache = readDatesCache(cacheFile);
cache.userId = userId;
if (flags.has('--dates')) {
  await completeDates(cache, cacheFile);
}

// El enlace se recalcula siempre desde url: así se corrigen los guardados con versiones anteriores.
// myTravelsArround no admite null en los campos opcionales: se omiten.
const items = exportable.map((item, index) => {
  const mapsUrlCanonical = toCanonicalMapsUrl(item.url);
  return {
    index: index + 1,
    url: item.url,
    ...(mapsUrlCanonical ? { mapsUrlCanonical } : {}),
    ...(item.imageUrl ? { imageUrl: toStableThumbnailUrl(item.imageUrl) } : {}),
    coordinates: item.coordinates,
    capturedAt: item.detailCapturedAt,
    ...takenAtFields(item, cache)
  };
});

const outPath = path.resolve(outArg || path.join(harvestDir, `${userId}.export.json`));
fs.writeFileSync(outPath, JSON.stringify({ total: items.length, items }, null, 2), 'utf8');
const withDate = items.filter((item) => item.takenAt).length;
console.log(`${items.length} fotos con coordenadas (de ${harvest.profileTotal ?? '¿?'}), ${withDate} con fecha -> ${outPath}`);
process.exit(0);
