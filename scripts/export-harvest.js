// Exporta las fotos ya resueltas en la fase 2 (harvest/<userId>.json) con el formato
// de contribuciones.json que lee myTravelsArround.
//
//   node scripts/export-harvest.js <userId> [salida.json] [--dates] [--retry-missing] [--concurrency=N]
//
// Por defecto escribe harvest/<userId>.export.json. No hace falta tener el backend arrancado.
//
// --dates: antes de exportar completa la fecha de captura (takenAt) de las fotos que aún no la
//   tienen, leyendo el EXIF del original (8 en paralelo, con freno automático si Google da
//   errores; ver completeDates en lib/taken-at.js). Se guarda en harvest/<userId>.dates.json
//   cada pocas fotos: se puede cortar con Ctrl+C y retomar.
// --concurrency=N: peticiones de fecha en paralelo (1–16, por defecto 8).
// --retry-missing: vuelve a pedir también las que la otra vez no tenían EXIF.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toCanonicalMapsUrl, toStableThumbnailUrl } from '../lib/maps-url.js';
import { completeDates, datesPath, parseConcurrencyFlag, pendingDates, readDatesCache, readPhotometaDates, takenAtFields } from '../lib/taken-at.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const harvestDir = path.join(root, 'harvest');
const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith('--')));
const [userId, outArg] = args.filter((arg) => !arg.startsWith('--'));

if (!/^\d+$/.test(String(userId || ''))) {
  console.error('Uso: node scripts/export-harvest.js <userId> [salida.json] [--dates] [--retry-missing] [--concurrency=N]');
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

const cacheFile = datesPath(harvestDir, userId);
const cache = readDatesCache(cacheFile);
cache.userId = userId;
if (flags.has('--dates')) {
  const photometa = readPhotometaDates(path.join(harvestDir, `${userId}.network.jsonl`));
  const pending = pendingDates(exportable, cache, flags.has('--retry-missing')).map((item) => ({
    key: item.key,
    label: item.photoId || item.key,
    day: photometa.get(String(item.photoId || '').replace(/^\d+:/, ''))
  }));
  let concurrency;
  try {
    concurrency = parseConcurrencyFlag(args);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  await completeDates(pending, cache, cacheFile, { concurrency });
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
