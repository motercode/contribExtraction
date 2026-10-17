// Fecha de captura de cada foto para el export.
//
// Fuentes, de mejor a peor:
//   1. item.takenAt en harvest/<userId>.json: lo guarda la fase 2 al abrir cada foto.
//   2. harvest/<userId>.dates.json: caché que rellena "npm run export -- --dates".
//      Va en un archivo aparte porque el backend reescribe harvest/<userId>.json mientras
//      la fase 2 está en marcha y las dos escrituras se pisarían.
//   3. (dentro de la caché, source "photometa") el día de captura que trae la respuesta de
//      la galería en harvest/<userId>.network.jsonl, sin hora, para fotos sin EXIF.
import fs from 'node:fs';
import { EXIF_RANGE_BYTES, readExifTakenAt } from './exif-date.js';

export const datesPath = (harvestDir, userId) => `${harvestDir}/${userId}.dates.json`;

export const readDatesCache = (file) => {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data.items === 'object' ? data : { items: {} };
  } catch {
    return { items: {} };
  }
};

export const writeDatesCache = (file, data) => {
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ ...data, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
  fs.renameSync(temp, file);
};

// Campos opcionales del export: se omiten si no hay fecha (myTravelsArround no admite null).
export const takenAtFields = (item, cache) => {
  if (item.takenAt) {
    return { takenAt: item.takenAt, takenAtSource: item.takenAtSource || 'exif' };
  }
  const cached = cache?.items?.[item.key];
  return cached?.takenAt ? { takenAt: cached.takenAt, takenAtSource: cached.source } : {};
};

// photoId sin prefijo ("CIHM...") -> "YYYY-MM-DD", leído de las respuestas de la galería
// capturadas en la fase 1. Cada foto es entrada[0] de d[22][1]; su fecha de captura va en
// [21][6][7] = [año, mes, día] y la de publicación en [21][6][8].
export const readPhotometaDates = (networkFile) => {
  const dates = new Map();
  if (!fs.existsSync(networkFile)) {
    return dates;
  }

  for (const line of fs.readFileSync(networkFile, 'utf8').split('\n')) {
    try {
      const { body } = JSON.parse(line);
      const data = JSON.parse(body.slice(body.indexOf('\n') + 1));
      for (const wrapper of data[22][1]) {
        const entry = wrapper[0];
        const [year, month, day] = entry[21][6][7];
        if (typeof entry[0] === 'string' && year && month && day) {
          dates.set(entry[0], `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
        }
      }
    } catch {
      // Línea de otra petición o con otro formato: se ignora.
    }
  }

  return dates;
};

// Pide solo el principio del JPG original y lee su EXIF.
// { takenAt } si lo encuentra, { takenAt: null } si la foto no tiene fecha (o ya no existe),
// y lanza error si el fallo es pasajero (red, 429, 5xx) para reintentarlo más tarde.
export const fetchExifTakenAt = async (key, timeoutMs = 15000) => {
  const response = await fetch(`${key}=d`, {
    headers: { Range: `bytes=0-${EXIF_RANGE_BYTES - 1}` },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (response.status === 404 || response.status === 403) {
    return { takenAt: null, status: response.status };
  }
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  // Si el servidor ignora el Range manda el archivo entero: se lee solo lo necesario.
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  while (length < EXIF_RANGE_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.length;
  }
  reader.cancel().catch(() => {});
  return { takenAt: readExifTakenAt(Buffer.concat(chunks)), status: response.status };
};
