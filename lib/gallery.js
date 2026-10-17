// Respuestas de la galería de un perfil (/locationhistory/preview/mas) -> fotos con el
// formato de contribuciones.json. Lo usan el backend (atajo) y scripts/export-network.js.
//
// Respuesta: ")]}'\n" + JSON. d[22] = [null, [[entrada, ...], ...], null, tokenSiguiente].
// Cada entrada:
//   entrada[0]               photoId ("CIHM...")
//   entrada[6][0]            miniatura (lh3.googleusercontent.com/gps-cs/...)
//   entrada[21][2][1]        tipo: 2 = 360°, 3 = foto normal, 4 = vídeo
//   entrada[21][2][2]        [alto, ancho] del original
//   entrada[21][4][1][0][5]  userId del autor
//   entrada[21][5][0][1][0]  [null, null, lat, lng]
//   entrada[21][6][7]        [año, mes, día] de captura (lo usa también readPhotometaDates)
import fs from 'node:fs';
import { toCanonicalMapsUrl, toStableThumbnailUrl } from './maps-url.js';
import { takenAtFields } from './taken-at.js';

export const galleryPath = (harvestDir, userId) => `${harvestDir}/${userId}.gallery.jsonl`;

// null si el cuerpo no es una respuesta de la galería.
export const parseGalleryBody = (body = '') => {
  try {
    const data = JSON.parse(String(body).slice(String(body).indexOf('\n') + 1));
    const block = data?.[22];
    if (!Array.isArray(block)) return null;
    return {
      entries: (block[1] || []).map((wrapper) => wrapper?.[0]).filter(Boolean),
      nextToken: typeof block[3] === 'string' && block[3] ? block[3] : null
    };
  } catch {
    return null;
  }
};

const pad = (value) => String(value).padStart(2, '0');

export const readGalleryPhoto = (entry) => {
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
  const imageUrl = typeof entry?.[6]?.[0] === 'string' ? entry[6][0] : null;
  return {
    photoId,
    kind: Number.isInteger(meta?.[2]?.[1]) ? meta[2][1] : null,
    authorId: meta?.[4]?.[1]?.[0]?.[5] || null,
    imageUrl,
    // Identifica la foto (sin tamaño ni encuadre): clave de dates.json y base del EXIF ("<key>=d").
    key: imageUrl ? imageUrl.split('=')[0] : null,
    lat,
    lng,
    width: Number.isInteger(width) ? width : null,
    height: Number.isInteger(height) ? height : null,
    day: year && month && day ? `${year}-${pad(month)}-${pad(day)}` : null
  };
};

export const VIDEO_KIND = 4;

const roundCoord = (value) => String(Number(value.toFixed(6)));

// URL de la galería de un perfil, como la que deja la fase 2. Sin el "!6s" (imagen grande),
// que la respuesta de la galería no trae: por eso los contadores son 6 y 4, no 7 y 5.
// toCanonicalMapsUrl añade "!3e11" y la convierte en la del visor general.
// "!1e" es el visor: 1 para fotos (360° y normales), 5 para vídeos (con 1e1 Maps no lo reproduce).
export const buildContribUrl = (photo, userId) => {
  const size = photo.width && photo.height ? [`!7i${photo.width}`, `!8i${photo.height}`] : [];
  const fields = [`!1s${photo.photoId}`, '!2e10', ...size];
  const viewer = photo.kind === VIDEO_KIND ? 5 : 1;
  return `https://www.google.com/maps/contrib/${userId}/photos/@${roundCoord(photo.lat)},${roundCoord(photo.lng)},3a,75y,90t`
    + `/data=!3m${fields.length + 2}!1e${viewer}!3m${fields.length}${fields.join('')}`;
};

// Fotos únicas de los registros, sin filtrar por coordenadas (para completar fechas).
export const listGalleryPhotos = (records, userId) => {
  const byId = new Map();
  for (const record of records) {
    for (const entry of parseGalleryBody(record.body)?.entries || []) {
      const photo = readGalleryPhoto(entry);
      if (photo && (!photo.authorId || photo.authorId === userId)) {
        byId.set(photo.photoId, photo);
      }
    }
  }
  return [...byId.values()];
};

// Registros guardados ({ url, body, capturedAt, ... }), uno por línea.
export const readGalleryRecords = (file) => {
  if (!fs.existsSync(file)) return [];
  const records = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // Línea cortada (proceso interrumpido): se ignora.
    }
  }
  return records;
};

// userId: el autor de las fotos (se descartan las de otros). asUserId: a nombre de quién
// salen en las URL (por defecto el mismo; scripts/export-network.js --test usa uno ficticio).
export const exportGallery = (records, { userId, asUserId = userId, datesCache = null }) => {
  const seen = new Set();
  const items = [];
  const counts = { responses: 0, unreadable: 0, entries: 0, invalid: 0, otherAuthor: 0, duplicated: 0 };

  for (const record of records) {
    counts.responses += 1;
    const page = parseGalleryBody(record.body);
    if (!page) {
      counts.unreadable += 1;
      continue;
    }

    for (const entry of page.entries) {
      counts.entries += 1;
      const photo = readGalleryPhoto(entry);
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
      const cached = photo.key ? takenAtFields({ key: photo.key }, datesCache) : {};
      const dates = cached.takenAt
        ? cached
        : photo.day ? { takenAt: photo.day, takenAtSource: 'photometa' } : {};

      const url = buildContribUrl(photo, asUserId);
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

  return { items, counts };
};
