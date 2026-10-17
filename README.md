# contribExtraction

Versión manual del extractor: usa un navegador normal de Chrome/Edge para hacer login manualmente si Google lo requiere y, a continuación, una extensión local de Chrome para extraer las contribuciones y enviarlas a un backend local que guarda `contribuciones.json`.

## Objetivo

- No se usa Playwright para dar login, porque Google detecta el navegador automatizado.
- Se usa un navegador real del sistema y una extensión local de Chrome.
- La extensión recoge fotos, textos y enlaces de contribuciones de Google Maps desde la pestaña abierta.
- El backend local guarda los resultados en `contribuciones.json`.

## Requisitos

- Node.js 18+
- Google Chrome o Chromium con permisos de extensión
- acceso a http://localhost:3000

## Instalación del backend

```bash
npm install
npm start
```

A continuación abre:

```text
http://localhost:3000
```

## Instalación de la extensión

1. Abre `chrome://extensions`
2. Activa "Modo desarrollador"
3. Pulsa "Cargar extensión sin empaquetar"
4. Selecciona la carpeta `extension/` de este repositorio

## Flujo recomendado

1. Abre el navegador Chrome real del sistema y, si Google pide login, haz login manualmente.
2. Navega a tu perfil público de Google Maps o a la sección de contribuciones.
3. Abre la extensión y pulsa "Extraer desde pestaña actual".
4. La extensión recorre la página con scroll y extrae fotos, textos y enlaces.
5. El backend guarda el JSON en `contribuciones.json`.
   - El formato es el mismo que el test: `{ "total": number, "items": [...] }` con `index`, `url`, `mapsUrlCanonical`, `imageUrl`, `coordinates` y `capturedAt`.

## Inventario completo de perfiles grandes (fase 1)

Para perfiles con miles de fotos (p. ej. 16.598), abrir cada foto en una sola ejecución no es viable: tardaría horas y cualquier fallo perdería todo. La fase 1 hace solo el **inventario**:

1. `npm start` y recarga la extensión en `chrome://extensions` (hay cambios en el manifest).
2. Abre la pestaña de fotos del perfil (`/maps/contrib/<userId>/photos`) y espera a que aparezca el total ("16.598 fotos").
3. En el popup, sección *Inventario completo*, pulsa **Iniciar**. Puedes cerrar el popup: la recogida sigue en la pestaña, que debe quedarse abierta.
4. **Detener** para pararla; lo pendiente se guarda. Volver a iniciar retoma sin duplicar.

Qué hace:

- Baja por la galería **sin abrir fotos** hasta llegar al total del perfil o hasta que deja de aparecer nada nuevo.
- Envía lo encontrado al backend cada 50 fotos. Se acumula en `harvest/<userId>.json`, sin duplicados (clave: `data-photo-bucket-iden` o la URL de la imagen sin el sufijo `=...`).
- Estado: `GET http://localhost:3000/api/harvest/<userId>` (total, con coordenadas, con URL).
- Diagnóstico: guarda una muestra de las respuestas de red de Maps con imágenes en `harvest/<userId>.network.jsonl` (`extension/network-tap.js`) y la estructura HTML de una miniatura en el log (`harvest_tile_sample`). Sirven para decidir si las coordenadas ya llegan por red o si hace falta la fase 2 (abrir cada foto, por lotes y reanudable).

## Coordenadas de cada foto (fase 2)

Usa el mismo mecanismo que "Extraer desde esta pestaña" (click en la miniatura y esperas de URL), pero sin tope de elementos, guardando por lotes y retomable.

1. Reinicia `npm start` y recarga la extensión en `chrome://extensions`.
2. Abre la pestaña de fotos del perfil (`/maps/contrib/<userId>/photos`).
3. En el popup, sección *Coordenadas (fase 2)*, pulsa **Iniciar / retomar**. Usa las pausas configuradas arriba. Puedes cerrar el popup; la pestaña debe seguir abierta.
4. **Detener** para pararla. Volver a pulsar **Iniciar / retomar** se salta las fotos que ya tienen coordenadas.

Qué hace:

- Abre cada miniatura y solo acepta la URL de detalle si contiene el id de esa miniatura (`data-photo-id="10:XXX"` → `!1sXXX` en la URL). Así nunca asigna a una foto las coordenadas de otra.
- Cada 20 fotos actualiza `harvest/<userId>.json`: rellena `url`, `mapsUrlCanonical`, `coordinates`, `photoId` y `detailCapturedAt` del item del inventario. La escritura es atómica.
- Una foto que falla 2 veces se deja sin `detailCapturedAt` y se reintenta en la siguiente ejecución. Con 10 fallos seguidos se para (sesión caducada, captcha, cambios en Maps…).
- Estado: `GET /api/harvest/<userId>` (`withDetail`). Resultado con el formato de `contribuciones.json`: `GET /api/harvest/<userId>/export` (botón *Abrir resultado*).
- Se salta las miniaturas que Google marca como «No se ha publicado» (no cuentan como fallo).
- Al capturar cada foto lee también la fecha de captura (`takenAt`) del EXIF del original: el background pide los primeros 64 KB de `<key>=d`. Si falla, la foto se guarda igual sin fecha.

## Fecha de captura (`takenAt`)

```bash
npm run export -- <userId> --dates            # completa las fechas que faltan y exporta
npm run export -- <userId> --dates --retry-missing   # reintenta también las que no tenían EXIF
```

- Pide una a una las fechas que faltan, con 1 s ± 0,5 s de pausa, y las guarda en `harvest/<userId>.dates.json` cada 20 fotos. Se puede cortar con Ctrl+C y retomar. Con 5 errores seguidos (429, red) se para.
- Si el original no tiene EXIF, usa el día de captura de `harvest/<userId>.network.jsonl` (`takenAtSource: "photometa"`, sin hora).
- `takenAt` es la hora de la cámara sin zona horaria (`2020-09-30T07:05:27`). Google quita el GPS del EXIF.
- Sin `--dates` el export es instantáneo y usa las fechas que ya haya.

## Verificación Playwright de 10 fotos

Para comparar el flujo real de Google Maps con un caso de prueba controlado, existe una verificación mínima que abre el perfil público y recopila los primeros 10 elementos secuencialmente:

```bash
npm run test:maps-11
```

Esto genera el archivo `contribuciones_test.json` con los 10 resultados esperados y sirve como referencia para el algoritmo manual y la extensión.

En ese JSON, la propiedad `url` de cada item se guarda con la URL final estable de navegación en la galería (la ruta completa de detalle con `/data=`), no con la URL intermedia del perfil.

Además, cada item incluye `mapsUrlCanonical`, una versión normalizada de `url` orientada al visor general de Maps (`https://www.google.com/maps/@...`), para facilitar enlaces consistentes fuera de la ruta de contribuciones.

Reglas de normalización de `mapsUrlCanonical`:

1. `https://www.google.com/maps/contrib/<userId>/photos/` se sustituye por `https://www.google.com/maps/`.
2. Se elimina el componente de roll `,xxxr` del bloque `@...` de la ruta.
3. En el bloque `data`, se normaliza el encabezado `!3m7!1e1!3m5!` a `!3m8!1e1!3m6!`.
4. Se elimina la cola específica de contribuciones `!4m3!8m2!3m1!1e1` cuando aparece.
5. Si no existe un marcador `!3e...!`, se inserta `!3e11` tras `!2e10`.

Notas:
- `url` (raw) y `mapsUrlCanonical` pueden abrir la misma foto, pero no son intercambiables a nivel de formato.
- La URL canónica no intenta cambiar de foto: conserva el `photoId` (`!1s...`) y la imagen embebida (`!6s...`) de la URL original.

## Regla importante sobre la galería

La navegación correcta no debe recargar la página ni volver atrás. La galería de Google Maps se comporta como una SPA: los botones numerados (`Foto 1 de N`, `Photo 2 of N`) siguen existiendo en el DOM y deben clickarse secuencialmente sin `goBack()`. Si la lista cambia de estructura, también se soporta el selector `data-photo-bucket-iden` como fallback para continuar con el siguiente item.

## Nota importante

Esta solución es "manual" porque Google bloquea navegadores automatizados. La extensión solo funciona sobre un navegador normal del usuario, no sobre Chromium controlado por Playwright.

## Logs en tiempo real

El backend expone un receptor de logs en `POST /api/log` para que la extensión envíe eventos de proceso en tiempo real. Cada ejecución usa un `sessionId` para agrupar los eventos y medir dónde se consume más tiempo.

También puedes consultar los últimos eventos con `GET /api/logs?limit=200`.

Los logs se guardan en `contribuciones_logs.jsonl` además de quedar visibles en la consola del backend.
