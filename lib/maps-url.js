// Miniatura estable para mostrar fuera de Maps. Las URLs de la galería traen parámetros de
// encuadre de panorama ("-pi0.29-ya264.8-ro5.9-fo100"): Google genera ese recorte del 360° al
// vuelo y, si no lo tiene en caché, responde 429 y el navegador bloquea la imagen (ORB).
// Un tamaño simple con recorte centrado ("-p") se sirve siempre. 400x240 cubre la miniatura
// de myTravelsArround (192x112 CSS) en pantallas de doble densidad.
export const toStableThumbnailUrl = (imageUrl = '') => {
  const base = String(imageUrl || '').split('=')[0];
  return /googleusercontent\.com/i.test(base) ? `${base}=w400-h240-p-k-no` : String(imageUrl || '');
};

// Convierte la URL de detalle de la galería de un perfil en la del visor general de Maps.
// Misma lógica que toCanonicalMapsUrl en extension/content.js (el content script no puede importar módulos).
//
// El bloque data= es un protobuf serializado: "!3m10" significa "los 10 campos siguientes son
// míos". Al insertar "!3e11" dentro del bloque de la foto hay que sumar 1 a los dos contadores
// que lo contienen; si no, Maps no entiende la URL y no abre la foto.
export const toCanonicalMapsUrl = (value = '') => {
  let url = String(value || '').trim();
  if (!url) {
    return '';
  }

  url = url.replace(/https:\/\/www\.google\.com\/maps\/contrib\/\d+\/photos\//i, 'https://www.google.com/maps/');
  url = url.replace(/,(-?\d+(?:\.\d+)?)r\//i, '/');

  const queryIndex = url.indexOf('?');
  const base = queryIndex >= 0 ? url.slice(0, queryIndex) : url;
  const query = queryIndex >= 0 ? url.slice(queryIndex) : '';
  const dataMatch = base.match(/^(.*\/data=)(.*)$/i);
  if (!dataMatch) {
    return url;
  }

  // Cola propia de la galería del perfil (1e1 o 1e2 según la sesión): no pertenece a la foto.
  let dataPayload = dataMatch[2].replace(/!4m3!8m2!3m1!1e\d$/i, '');

  const photoBlock = dataPayload.match(/^!3m(\d+)!1e(\d+)!3m(\d+)!/i);
  if (photoBlock) {
    const [whole, outerRaw, kind, innerRaw] = photoBlock;
    let outer = Number(outerRaw);
    let inner = Number(innerRaw);
    let rest = dataPayload.slice(whole.length);

    // "!9m2!1b1!2i46" abre la foto con el mapa expandido; sin él sale con el mapa colapsado.
    // Se quita el bloque con sus campos y se descuentan de los dos contadores que lo contienen.
    const expandedMap = rest.match(/!9m(\d+)((?:![^!]+)*)/i);
    if (expandedMap) {
      const fieldCount = Number(expandedMap[1]);
      const fields = expandedMap[2].split('!').slice(1, fieldCount + 1);
      const removed = `!9m${fieldCount}${fields.map((field) => `!${field}`).join('')}`;
      rest = rest.replace(removed, '');
      outer -= fieldCount + 1;
      inner -= fieldCount + 1;
    }

    if (!/!3e\d+!/i.test(rest) && /!2e10!/i.test(`!${rest}`)) {
      rest = `!${rest}`.replace(/(!2e10)(!|$)/i, '$1!3e11$2').slice(1);
      outer += 1;
      inner += 1;
    }

    dataPayload = `!3m${outer}!1e${kind}!3m${inner}!${rest}`;
  }

  return `${dataMatch[1]}${dataPayload}${query}`;
};
