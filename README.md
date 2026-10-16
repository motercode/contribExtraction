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
