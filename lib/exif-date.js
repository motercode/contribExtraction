// Fecha y hora de captura de una foto a partir del EXIF del JPG original.
// Misma lógica que readExifTakenAt en extension/background.js (el service worker no puede importar módulos).
//
// Google conserva el EXIF en el original ("<key>=d") pero quita el GPS. El bloque EXIF va al
// principio del archivo, así que basta con pedir los primeros EXIF_RANGE_BYTES (respuesta 206)
// en vez de los ~7 MB de la panorámica.
export const EXIF_RANGE_BYTES = 65536;

const TAG_EXIF_IFD = 0x8769;
const TAG_DATETIME = 0x0132;
const TAG_DATETIME_ORIGINAL = 0x9003;
const EXIF_DATE = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/;

// Devuelve "YYYY-MM-DDTHH:MM:SS" (hora de la cámara, sin zona: el EXIF no la trae) o null.
export const readExifTakenAt = (input) => {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1];
    const size = view.getUint16(offset + 2);
    if (marker === 0xda) {
      break; // Empieza la imagen: ya no hay más cabeceras.
    }
    // APP1 con firma "Exif\0\0".
    if (marker === 0xe1 && String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) === 'Exif') {
      return readTiffTakenAt(view, offset + 10, Math.min(bytes.length, offset + 2 + size));
    }
    offset += 2 + size;
  }

  return null;
};

const readTiffTakenAt = (view, tiff, end) => {
  if (tiff + 8 > end) {
    return null;
  }
  const little = view.getUint16(tiff) === 0x4949; // "II"
  const u16 = (at) => view.getUint16(at, little);
  const u32 = (at) => view.getUint32(at, little);

  // Busca una etiqueta en un IFD y devuelve [nº de valores, offset del valor] o null.
  const findTag = (ifd, tag) => {
    if (ifd + 2 > end) {
      return null;
    }
    const count = u16(ifd);
    for (let i = 0; i < count; i += 1) {
      const entry = ifd + 2 + i * 12;
      if (entry + 12 > end) {
        return null;
      }
      if (u16(entry) === tag) {
        return [u32(entry + 4), u32(entry + 8)];
      }
    }
    return null;
  };

  const readDate = (found) => {
    if (!found) {
      return null;
    }
    const [length, valueOffset] = found;
    const start = tiff + valueOffset;
    if (length < 19 || start + 19 > end) {
      return null;
    }
    let text = '';
    for (let i = 0; i < 19; i += 1) {
      text += String.fromCharCode(view.getUint8(start + i));
    }
    const match = text.match(EXIF_DATE);
    if (!match || match[1] === '0000') {
      return null;
    }
    const [, y, mo, d, h, mi, s] = match;
    return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
  };

  const ifd0 = tiff + u32(tiff + 4);
  const exifPointer = findTag(ifd0, TAG_EXIF_IFD);
  const original = exifPointer ? readDate(findTag(tiff + exifPointer[1], TAG_DATETIME_ORIGINAL)) : null;
  // DateTime (IFD0) es la fecha de la última modificación; solo si no hay DateTimeOriginal.
  return original || readDate(findTag(ifd0, TAG_DATETIME));
};
