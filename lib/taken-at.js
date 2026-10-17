// Fecha de captura de cada foto para el export.
//
// Fuentes, de mejor a peor:
//   1. item.takenAt en harvest/<userId>.json: lo guarda la fase 2 al abrir cada foto.
//   2. harvest/<userId>.dates.json: caché que rellena "npm run export -- --dates" (o
//      "npm run exportGallery -- <userId> --dates").
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

// Probado el 2026-10-17: hasta 16 en paralelo sin un solo error ni subida de latencia
// (~0,4 s por foto); 600 seguidas con 8 en paralelo a ~19 fotos/s, también sin errores.
export const DATES_DEFAULT_CONCURRENCY = 8;
export const DATES_MAX_CONCURRENCY = 16;
const DATES_JITTER_MS = 150;
const DATES_SAVE_EVERY = 50;
const DATES_PROGRESS_EVERY = 250;
const DATES_BACKOFF_MS = 5000;
const DATES_MAX_BACKOFF_MS = 60000;
const DATES_RECOVER_AFTER = 100;
const DATES_MAX_TRIES = 3;
const DATES_MAX_CONSECUTIVE_ERRORS = 5;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Fotos ({ key, takenAt? }) a las que aún les falta la fecha en la caché. retryMissing: también
// las que la otra vez no tenían EXIF.
export const pendingDates = (items, cache, retryMissing = false) =>
  items.filter((item) => {
    if (item.takenAt) return false;
    const cached = cache.items[item.key];
    return !cached || (retryMissing && cached.source !== 'exif');
  });

// "--concurrency=N" de la línea de comandos (1–16); por defecto DATES_DEFAULT_CONCURRENCY.
export const parseConcurrencyFlag = (args) => {
  const raw = args.find((arg) => arg.startsWith('--concurrency='))?.split('=')[1];
  if (raw === undefined) return DATES_DEFAULT_CONCURRENCY;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > DATES_MAX_CONCURRENCY) {
    throw new Error(`--concurrency debe ser un entero entre 1 y ${DATES_MAX_CONCURRENCY}.`);
  }
  return value;
};

// Completa la caché leyendo el EXIF de cada foto, con hasta `concurrency` peticiones a la vez.
// pending: [{ key, label, day }]; day ("YYYY-MM-DD", de la galería) se usa si no hay EXIF.
//
// Freno automático: ante un error pasajero (red, 429, 5xx) baja a la mitad las peticiones en
// paralelo y pausa todas 5 s (luego 10, 20… hasta 60 s si sigue fallando); los errores que
// llegan durante la pausa no cuentan otra vez. Tras 100 aciertos seguidos sube una.
// La foto se reintenta hasta 3 veces en esta ejecución; si no, queda para la siguiente.
// Con 1 en paralelo y 5 errores seguidos, se para. Guarda cada 50 fotos y al terminar: se
// puede cortar con Ctrl+C y retomar.
export const completeDates = async (pending, cache, cacheFile, { concurrency = DATES_DEFAULT_CONCURRENCY } = {}) => {
  if (pending.length === 0) {
    console.log('Fechas: todas las fotos ya la tienen.');
    return;
  }

  const maxConcurrency = Math.max(1, Math.min(DATES_MAX_CONCURRENCY, Math.floor(concurrency)));
  const queue = pending.map((item) => ({ item, tries: 0 }));
  const counts = { exif: 0, photometa: 0, none: 0, failed: 0 };
  const startedAt = Date.now();
  let limit = maxConcurrency;
  let active = 0;
  let pausedUntil = 0;
  let backoffMs = DATES_BACKOFF_MS;
  let successStreak = 0;
  let errorsAtMinimum = 0;
  let done = 0;
  let lastProgressAt = 0;
  let sinceSave = 0;
  let interrupted = false;
  let stopped = false;

  process.on('SIGINT', () => {
    interrupted = true;
    console.log('\nDeteniendo… se guarda lo que hay.');
  });

  // ~2 fotos/s por petición en paralelo (0,4 s cada una más la pausa aleatoria).
  console.log(`Fechas: ${pending.length} pendientes, ${maxConcurrency} en paralelo (~${Math.max(1, Math.ceil(pending.length / (maxConcurrency * 2) / 60))} min). Ctrl+C para parar y retomar luego.`);

  const onSuccess = () => {
    successStreak += 1;
    errorsAtMinimum = 0;
    backoffMs = DATES_BACKOFF_MS;
    if (successStreak >= DATES_RECOVER_AFTER && limit < maxConcurrency) {
      limit += 1;
      successStreak = 0;
      console.log(`  Sin errores: sube a ${limit} en paralelo.`);
    }
  };

  const onError = (job, error) => {
    const previousLimit = limit;
    successStreak = 0;
    job.tries += 1;
    if (job.tries < DATES_MAX_TRIES) {
      queue.push(job);
    } else {
      counts.failed += 1;
    }

    // Las peticiones que ya estaban en marcha fallan juntas: es un solo aviso, no varios.
    if (Date.now() < pausedUntil) {
      return;
    }

    limit = Math.max(1, Math.floor(limit / 2));
    pausedUntil = Date.now() + backoffMs;
    console.warn(`  ${job.item.label || job.item.key}: ${error.message} → ${limit} en paralelo, pausa de ${backoffMs / 1000} s`);
    backoffMs = Math.min(DATES_MAX_BACKOFF_MS, backoffMs * 2);

    if (previousLimit === 1) {
      errorsAtMinimum += 1;
      if (errorsAtMinimum >= DATES_MAX_CONSECUTIVE_ERRORS) {
        stopped = true;
        console.warn(`Fechas: ${DATES_MAX_CONSECUTIVE_ERRORS} errores seguidos con 1 en paralelo, se para (¿Google limitando?). Vuelve a lanzarlo más tarde.`);
      }
    }
  };

  const worker = async (slot) => {
    while (!interrupted && !stopped) {
      // Este hueco sobra mientras el freno tenga bajado el límite, o todo está en pausa.
      if (slot >= limit || Date.now() < pausedUntil) {
        if (queue.length === 0 && active === 0) return;
        await sleep(500);
        continue;
      }

      const job = queue.shift();
      if (!job) {
        // Otro hueco aún puede devolver una foto a la cola si falla.
        if (active === 0) return;
        await sleep(200);
        continue;
      }

      active += 1;
      try {
        const { takenAt } = await fetchExifTakenAt(job.item.key);
        const entry = takenAt
          ? { takenAt, source: 'exif' }
          : job.item.day
            ? { takenAt: job.item.day, source: 'photometa' }
            : { takenAt: null, source: 'none' };
        cache.items[job.item.key] = { ...entry, checkedAt: new Date().toISOString() };
        counts[entry.source] += 1;
        done += 1;
        sinceSave += 1;
        onSuccess();
      } catch (error) {
        onError(job, error);
      } finally {
        active -= 1;
      }

      if (sinceSave >= DATES_SAVE_EVERY) {
        writeDatesCache(cacheFile, cache);
        sinceSave = 0;
      }
      if (done - lastProgressAt >= DATES_PROGRESS_EVERY) {
        lastProgressAt = done;
        const perSecond = done / ((Date.now() - startedAt) / 1000);
        console.log(`  ${done}/${pending.length} · ${perSecond.toFixed(1)} fotos/s · exif ${counts.exif} · solo día ${counts.photometa} · sin fecha ${counts.none}`);
      }
      // Cadencia irregular: 0–150 ms entre peticiones de cada hueco.
      await sleep(Math.random() * DATES_JITTER_MS);
    }
  };

  await Promise.all(Array.from({ length: maxConcurrency }, (_, slot) => worker(slot)));

  writeDatesCache(cacheFile, cache);
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  const left = queue.length + counts.failed;
  console.log(`Fechas: exif ${counts.exif} · solo día ${counts.photometa} · sin fecha ${counts.none} en ${seconds} s${left ? ` · ${left} pendientes para la próxima vez` : ''}`);
};
