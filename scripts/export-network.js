// Exporta directamente desde las respuestas de la galería, sin abrir cada foto (fase 2).
// Formato de contribuciones.json.
//
//   node scripts/export-network.js [--test] <userId> [salida.json] [--dates] [--retry-missing] [--concurrency=N]
//   npm run exportGallery -- <userId> [salida.json] [--dates] [--retry-missing] [--concurrency=N]
//   npm run exportTest -- <userId> [salida.json]      (= --test)
//
// Lee harvest/<userId>.gallery.jsonl (atajo de la extensión, la galería completa) o, si no
// existe, harvest/<userId>.network.jsonl (muestra de red de la fase 1).
// --test: las fotos salen a nombre de un usuario ficticio (TEST_USER_ID, "testA" en
// myTravelsArround) para verlas en el mapa junto a las del export normal y compararlas.
// --dates: antes de exportar completa la hora de captura (EXIF) de las fotos que aún no la
//   tienen en harvest/<userId>.dates.json, una petición por foto (8 en paralelo, con freno
//   automático si Google da errores; ver completeDates en lib/taken-at.js). Los vídeos se
//   saltan (no tienen EXIF de foto). Se puede cortar con Ctrl+C y retomar.
// --concurrency=N: peticiones de fecha en paralelo (1–16, por defecto 8).
// --retry-missing: vuelve a pedir también las que la otra vez no tenían EXIF.
// Por defecto escribe harvest/<userId>.network-export.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VIDEO_KIND, exportGallery, galleryPath, listGalleryPhotos, readGalleryRecords } from '../lib/gallery.js';
import { completeDates, datesPath, parseConcurrencyFlag, pendingDates, readDatesCache } from '../lib/taken-at.js';

// userId ficticio (no existe en Google): myTravelsArround lo muestra como "testA".
const TEST_USER_ID = '999999999999999999999';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const harvestDir = path.join(root, 'harvest');
const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith('--')));
const asTest = flags.has('--test');
const [userId, outArg] = args.filter((arg) => !arg.startsWith('--'));

if (!/^\d+$/.test(String(userId || ''))) {
  console.error('Uso: node scripts/export-network.js [--test] <userId> [salida.json] [--dates] [--retry-missing] [--concurrency=N]');
  process.exit(1);
}

const sourceFile = [galleryPath(harvestDir, userId), path.join(harvestDir, `${userId}.network.jsonl`)]
  .find((file) => fs.existsSync(file));
if (!sourceFile) {
  console.error(`No hay ${userId}.gallery.jsonl ni ${userId}.network.jsonl en ${harvestDir}: lanza el atajo desde la extensión.`);
  process.exit(1);
}

const records = readGalleryRecords(sourceFile);
const cacheFile = datesPath(harvestDir, userId);
const cache = readDatesCache(cacheFile);
cache.userId = userId;

if (flags.has('--dates')) {
  const photos = listGalleryPhotos(records, userId).filter((photo) => photo.key && photo.kind !== VIDEO_KIND);
  const pending = pendingDates(photos, cache, flags.has('--retry-missing'))
    .map((photo) => ({ key: photo.key, label: photo.photoId, day: photo.day }));
  let concurrency;
  try {
    concurrency = parseConcurrencyFlag(args);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  await completeDates(pending, cache, cacheFile, { concurrency });
}

const { items, counts } = exportGallery(records, {
  userId,
  asUserId: asTest ? TEST_USER_ID : userId,
  datesCache: cache
});

// Comparación con lo que ya resolvió la fase 2 (si existe el harvest).
const harvestFile = path.join(harvestDir, `${userId}.json`);
if (fs.existsSync(harvestFile)) {
  const harvest = JSON.parse(fs.readFileSync(harvestFile, 'utf8'));
  const detailed = new Map(
    harvest.items
      .filter((item) => item.detailCapturedAt && item.photoId && item.coordinates)
      .map((item) => [String(item.photoId).replace(/^\d+:/, ''), item.coordinates])
  );
  const toRad = (deg) => (deg * Math.PI) / 180;
  const meters = (a, b) => {
    const dLat = toRad(b.latitude - a.latitude);
    const dLng = toRad(b.longitude - a.longitude);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.sqrt(h));
  };

  let both = 0;
  let over50m = 0;
  for (const item of items) {
    const photoId = item.url.match(/!1s([^!]+)/)[1];
    const other = detailed.get(photoId);
    if (!other) continue;
    both += 1;
    if (meters(item.coordinates, other) > 50) over50m += 1;
  }
  console.log(`Fase 2: ${detailed.size} fotos con detalle; ${both} también aquí, ${over50m} a más de 50 m; ${items.length - both} nuevas.`);
}

const outPath = path.resolve(outArg || path.join(harvestDir, `${userId}.network-export.json`));
fs.writeFileSync(outPath, JSON.stringify({ total: items.length, items }, null, 2), 'utf8');

const exif = items.filter((item) => item.takenAtSource === 'exif').length;
const dayOnly = items.filter((item) => item.takenAtSource === 'photometa').length;
const author = asTest ? `testA (${TEST_USER_ID})` : userId;
console.log(`Origen: ${path.basename(sourceFile)} · ${counts.responses} respuestas (${counts.unreadable} ilegibles), ${counts.entries} entradas, ${counts.invalid} sin coordenadas, ${counts.otherAuthor} de otro autor, ${counts.duplicated} repetidas.`);
console.log(`${items.length} fotos a nombre de ${author}, ${exif} con fecha EXIF y ${dayOnly} solo con día -> ${outPath}`);
