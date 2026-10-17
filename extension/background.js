chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ lastResult: [] });
});

const postLogEvent = async (payload = {}) => {
  const response = await fetch('http://localhost:3000/api/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  let result = null;
  try {
    result = await response.json();
  } catch {
    result = null;
  }

  return { ok: response.ok, result };
};

const postJson = async (path, payload) => {
  const response = await fetch(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  let result = null;
  try {
    result = await response.json();
  } catch {
    result = null;
  }

  return { ok: response.ok && result?.ok !== false, result, error: result?.error || null };
};

// --- Fecha de captura (EXIF del original) ---
// Misma lógica que lib/exif-date.js (el service worker no puede importar módulos).
// Google conserva el EXIF en "<key>=d" (sin GPS) y va al principio del archivo: con los
// primeros 64 KB basta, en vez de los ~7 MB de la panorámica.
const EXIF_RANGE_BYTES = 65536;
const EXIF_FETCH_TIMEOUT_MS = 8000;

const readExifTakenAt = (buffer) => {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const readTiff = (tiff, end) => {
    if (tiff + 8 > end) return null;
    const little = view.getUint16(tiff) === 0x4949;
    const u16 = (at) => view.getUint16(at, little);
    const u32 = (at) => view.getUint32(at, little);
    const findTag = (ifd, tag) => {
      if (ifd + 2 > end) return null;
      const count = u16(ifd);
      for (let i = 0; i < count; i += 1) {
        const entry = ifd + 2 + i * 12;
        if (entry + 12 > end) return null;
        if (u16(entry) === tag) return [u32(entry + 4), u32(entry + 8)];
      }
      return null;
    };
    const readDate = (found) => {
      if (!found || found[0] < 19 || tiff + found[1] + 19 > end) return null;
      const text = String.fromCharCode(...bytes.subarray(tiff + found[1], tiff + found[1] + 19));
      const match = text.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
      if (!match || match[1] === '0000') return null;
      return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`;
    };
    const ifd0 = tiff + u32(tiff + 4);
    const exifPointer = findTag(ifd0, 0x8769);
    const original = exifPointer ? readDate(findTag(tiff + exifPointer[1], 0x9003)) : null;
    return original || readDate(findTag(ifd0, 0x0132));
  };

  let offset = 2;
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1];
    const size = view.getUint16(offset + 2);
    if (marker === 0xda) break;
    if (marker === 0xe1 && String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) === 'Exif') {
      return readTiff(offset + 10, Math.min(bytes.length, offset + 2 + size));
    }
    offset += 2 + size;
  }
  return null;
};

const fetchTakenAt = async (key) => {
  if (!/^https:\/\/lh3\.googleusercontent\.com\//i.test(String(key || ''))) {
    return { ok: false, error: 'key no es una imagen de googleusercontent' };
  }
  const response = await fetch(`${key}=d`, {
    headers: { Range: `bytes=0-${EXIF_RANGE_BYTES - 1}` },
    signal: AbortSignal.timeout(EXIF_FETCH_TIMEOUT_MS)
  });
  if (!response.ok) {
    return { ok: false, error: `HTTP ${response.status}` };
  }
  const buffer = await response.arrayBuffer();
  return { ok: true, takenAt: readExifTakenAt(buffer.slice(0, EXIF_RANGE_BYTES)) };
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'TAKEN_AT') {
    fetchTakenAt(message.key)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));

    return true;
  }

  if (message.type === 'HARVEST_SAVE' || message.type === 'HARVEST_NETWORK_SAMPLE') {
    const path = message.type === 'HARVEST_SAVE' ? '/api/harvest' : '/api/harvest/network';
    postJson(path, message.payload)
      .then((result) => sendResponse(result))
      .catch(() => {
        sendResponse({ ok: false, error: 'No se pudo contactar con el backend local (npm start).' });
      });

    return true;
  }

  if (message.type === 'DETAIL_SAVE') {
    postJson('/api/harvest/details', message.payload)
      .then((result) => sendResponse(result))
      .catch(() => {
        sendResponse({ ok: false, error: 'No se pudo contactar con el backend local (npm start).' });
      });

    return true;
  }

  if (message.type === 'DETAIL_DONE') {
    fetch(`http://localhost:3000/api/harvest/${encodeURIComponent(message.userId)}/done`)
      .then(async (response) => {
        const result = await response.json();
        sendResponse({ ok: response.ok && result?.ok !== false, result, error: result?.error || null });
      })
      .catch(() => {
        sendResponse({ ok: false, error: 'No se pudo contactar con el backend local (npm start).' });
      });

    return true;
  }

  if (message.type === 'SAVE_EXPORT') {
    fetch('http://localhost:3000/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message.payload)
    })
      .then(async (response) => {
        const result = await response.json();
        sendResponse({ ok: response.ok, result });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: String(error) });
      });

    return true;
  }

  if (message.type === 'LOG_EVENT') {
    postLogEvent(message.payload)
      .then((result) => sendResponse(result))
      .catch((error) => {
        sendResponse({ ok: false, error: String(error) });
      });

    return true;
  }

  return false;
});
