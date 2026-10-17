// Exporta directamente desde las respuestas de la galería capturadas en la fase 1
// (harvest/<userId>.network.jsonl), sin abrir cada foto (fase 2). Formato de contribuciones.json.
//
//   node scripts/export-network.js <userId> [salida.json]
//   npm run exportTest -- <userId> [salida.json]
//
// Es una prueba: las fotos salen a nombre de un usuario ficticio (TEST_USER_ID, "testA" en
// myTravelsArround) para verlas en el mapa junto a las de la fase 2 y compararlas.
// Por defecto escribe harvest/<userId>.network-export.json.
//
// Cada foto es entrada[0] de d[22][1] en la respuesta de /locationhistory/preview/mas:
//   entrada[0]               photoId ("CIHM...")
//   entrada[6][0]            miniatura (lh3.googleusercontent.com/gps-cs/...)
//   entrada[21][2][2]        [alto, ancho] del original
//   entrada[21][4][1][0][5]  userId del autor
//   entrada[21][5][0][1][0]  [null, null, lat, lng]
//   entrada[21][6][7]        [año, mes, día] de captura (lo usa también readPhotometaDates)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toCanonicalMapsUrl, toStableThumbnailUrl } from '../lib/maps-url.js';
import { datesPath, readDatesCache, takenAtFields } from '../lib/taken-at.js';

// userId ficticio (no existe en Google): myTravelsArround lo muestra como "testA".
const TEST_USER_ID = '999999999999999999999';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const harvestDir = path.join(root, 'harvest');
const [userId, outArg] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));

if (!/^\d+$/.test(String(userId || ''))) {
  console.error('Uso: node scripts/export-network.js <userId> [salida.json]');
  process.exit(1);
}

const networkFile = path.join(harvestDir, `${userId}.network.jsonl`);
if (!fs.existsSync(networkFile)) {
  console.error(`No existe ${networkFile}: hace falta la fase 1 (inventario) con la captura de red.`);
  process.exit(1);
}

const roundCoord = (value) => String(Number(value.toFixed(6)));
const pad = (value) => String(value).padStart(2, '0');

const readEntry = (entry) => {
  const meta = entry?.[21];
  const photoId = entry?.[0];
  const position = meta?.[5]?.[0]?.[1]?.[0];
  const [height, width] = meta?.[2]?.[2] || [];
  const lat = position?.[2];
  const lng = position?.[3];
  if (typeof photoId !== 'string' || typeof lat !== 'number' || typeof lng !== 'number') {
    return null;
  }
  if ((lat === 0 && lng === 0) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return null;
  }

  const [year, month, day] = meta?.[6]?.[7] || [];
  return {
    photoId,
    authorId: meta?.[4]?.[1]?.[0]?.[5] || null,
    imageUrl: typeof entry?.[6]?.[0] === 'string' ? entry[6][0] : null,
    lat,
    lng,
    width: Number.isInteger(width) ? width : null,
    height: Number.isInteger(height) ? height : null,
    day: year && month && day ? `${year}-${pad(month)}-${pad(day)}` : null
  };
};

// URL de la galería de un perfil, como la que deja la fase 2. Sin el "!6s" (imagen grande),
// que la respuesta de la galería no trae: por eso los contadores son 6 y 4, no 7 y 5.
// toCanonicalMapsUrl añade "!3e11" y la convierte en la del visor general.
const buildContribUrl = (photo) => {
  const size = photo.width && photo.height ? [`!7i${photo.width}`, `!8i${photo.height}`] : [];
  const fields = [`!1s${photo.photoId}`, '!2e10', ...size];
  return `https://www.google.com/maps/contrib/${TEST_USER_ID}/photos/@${roundCoord(photo.lat)},${roundCoord(photo.lng)},3a,75y,90t`
    + `/data=!3m${fields.length + 2}!1e1!3m${fields.length}${fields.join('')}`;
};

const cache = readDatesCache(datesPath(harvestDir, userId));
const seen = new Set();
const items = [];
const counts = { lines: 0, unreadable: 0, entries: 0, invalid: 0, otherAuthor: 0, duplicated: 0 };

for (const line of fs.readFileSync(networkFile, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  counts.lines += 1;

  let record;
  let data;
  try {
    record = JSON.parse(line);
    data = JSON.parse(record.body.slice(record.body.indexOf('\n') + 1));
  } catch {
    counts.unreadable += 1;
    continue;
  }

  for (const wrapper of data?.[22]?.[1] || []) {
    counts.entries += 1;
    const photo = readEntry(wrapper?.[0]);
    if (!photo) {
      counts.invalid += 1;
      continue;
    }
    if (photo.authorId && photo.authorId !== userId) {
      counts.otherAuthor += 1;
      continue;
    }
    if (seen.has(photo.photoId)) {
      counts.duplicated += 1;
      continue;
    }
    seen.add(photo.photoId);

    // Fecha: EXIF de la caché de "npm run export -- --dates" (clave: imagen sin "=..."); si no,
    // el día que trae la propia galería.
    const key = photo.imageUrl ? photo.imageUrl.split('=')[0] : null;
    const cached = key ? takenAtFields({ key }, cache) : {};
    const dates = cached.takenAt
      ? cached
      : photo.day ? { takenAt: photo.day, takenAtSource: 'photometa' } : {};

    const url = buildContribUrl(photo);
    items.push({
      index: items.length + 1,
      url,
      mapsUrlCanonical: toCanonicalMapsUrl(url),
      ...(photo.imageUrl ? { imageUrl: toStableThumbnailUrl(photo.imageUrl) } : {}),
      coordinates: { latitude: photo.lat, longitude: photo.lng },
      capturedAt: record.capturedAt,
      ...dates
    });
  }
}

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
console.log(`Red: ${counts.lines} respuestas (${counts.unreadable} ilegibles), ${counts.entries} entradas, ${counts.invalid} sin coordenadas, ${counts.otherAuthor} de otro autor, ${counts.duplicated} repetidas.`);
console.log(`${items.length} fotos como testA (${TEST_USER_ID}), ${exif} con fecha EXIF y ${dayOnly} solo con día -> ${outPath}`);
