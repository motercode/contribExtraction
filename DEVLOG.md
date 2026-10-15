# DEVLOG — playwright-verify-11.js

Lecciones aprendidas durante el desarrollo del script de extracción de contribuciones de Google Maps con Playwright. Este documento existe para no repetir los mismos errores.

---

## Cómo ejecutar

```bash
npm run test:maps-11
```

Genera `contribuciones_test.json` en la raíz del proyecto.

---

## Estructura del JSON de salida

```json
{
  "total": 10,
  "items": [
    {
      "index": 1,
      "url": "https://www.google.com/maps/contrib/.../photos/@lat,lng,...r/data=...",
      "imageUrl": "https://lh3.googleusercontent.com/gps-cs/...",
      "coordinates": { "latitude": 42.88, "longitude": -5.79 },
      "capturedAt": "2026-10-15T18:00:00.000Z"
    }
  ]
}
```

---

## Reglas clave (lo que funciona)

### 1. Google Maps es un SPA — el DOM no se destruye al navegar

Cuando haces click en una miniatura del perfil, la URL cambia pero **el DOM del perfil sigue intacto**. Los botones `"Foto N de M"` siguen ahí. Esto significa:

- **No necesitas `page.goBack()`** para volver al perfil
- **No necesitas cerrar ningún visor**
- Puedes seguir clickando botones del perfil aunque la URL sea la del visor de fotos

### 2. El patrón de navegación correcto (sacado de la extensión)

La extensión `extension/content.js` ya lo resuelve bien en `nextPhotoInGallery`. El loop correcto es:

```js
for (let cursor = 0; cursor < total; cursor++) {
  // Los botones "Foto N de M" están SIEMPRE en el DOM (SPA)
  const buttons = document.querySelectorAll('button, [role="button"]')
    .filter(btn => /foto\s+\d+\s+de\s+\d+|photo\s+\d+\s+of\s+\d+/i.test(
      btn.getAttribute('aria-label') || btn.textContent
    ));

  buttons[cursor].click();             // click thumbnail en posición cursor
  await waitForUrlChange(previousUrl); // esperar cambio de URL
  // capturar datos...
  // NO hacer goBack(), NO cerrar visor, NO recargar perfil
}
```

### 3. `imageUrl` — cómo obtenerla correctamente

Los `<img decoding="async" style="position: absolute; top: 50%; left: 50%">` son las **miniaturas del perfil** y están **todas en el DOM antes del primer click**. Captúralas de una vez antes del loop:

```js
const allThumbnailSrcs = await getViewerImageSrcs(page); // snapshot previo
// Luego en el loop:
const imageUrl = allThumbnailSrcs[cursor]; // índice == posición del thumbnail
```

El src tiene formato `gps-cs/AH1DqX_...=w600-h321-p-k-no-pi-...` — es la URL renderizada del visor con ángulo y dimensiones específicos.

### 4. `url` — qué capturar y cuándo

Usar `waitForUrlChange` + `waitForUrlStable`:
- `waitForUrlChange`: detecta el primer cambio de URL tras el click
- `waitForUrlStable`: espera hasta que la URL deja de cambiar (1,5 s de estabilidad)

La URL ya incluye desde el primer cambio: coordenadas `@lat,lng`, heading/tilt/roll y el bloque `data=` completo. **No hay que esperar más.**

### 5. `g_ep` — por qué varía y por qué no importa

`g_ep` es la versión del catálogo de datos de Maps. Google la fija al cargar la página de perfil y **no la actualiza durante la sesión**. Su valor cambia entre días cuando Google actualiza sus datos. La URL funciona correctamente con cualquier valor de `g_ep`.

### 6. Usa `playwright codegen` para entender la interacción real

Cuando el script no sabe cómo navegar, lanza codegen con `--output` y haz la interacción manualmente:

```bash
npx playwright codegen --channel chromium --output scripts/codegen-recorded.js \
  https://www.google.com/maps/contrib/.../photos
```

El fichero generado muestra exactamente qué selectores usa el navegador.

---

## Errores cometidos (y cómo no repetirlos)

### ❌ Error 1 — `imageUrl` igual para todos los items

**Qué pasó:** Se intentó capturar el `<img>` del visor DESPUÉS del click. Como el DOM del SPA persiste, el primer match siempre devolvía el mismo elemento (la primera miniatura del perfil).

**Intentos fallidos:**
- `waitForFunction` esperando un `<img>` nuevo → nunca aparece, el DOM ya lo tiene todo
- Devolver el último match del selector → sigue siendo el mismo elemento
- Fallback al parámetro `!6s` de la URL → funciona pero da imagen raw (`gpms-cs-s`), no la renderizada (`gps-cs`)

**Solución:** Capturar todos los `allThumbnailSrcs` ANTES del loop y usar `allThumbnailSrcs[cursor]`.

---

### ❌ Error 2 — `waitForPhotoDetailUrl` causaba bucle de recarga

**Qué pasó:** Se añadió una función que esperaba a que la URL contuviese `/data=`. El problema: Maps actualiza la URL en pasos (primero sin `/data=`, luego con). La función esperaba 20 s, el navegador entraba en estado indefinido y finalmente:

```
page.waitForTimeout: Target page, context or browser has been closed
```

**Regla:** Nunca esperar un patrón de URL demasiado específico en Maps. Usar `waitForUrlChange` (cualquier cambio) + `waitForUrlStable` (estabilidad).

---

### ❌ Error 3 — `page.goBack()` recargaba el perfil innecesariamente

**Qué pasó:** El loop original hacía `page.goBack()` tras cada foto para volver al perfil y hacer click en la siguiente miniatura. Esto recargaba la página y reiniciaba el DOM.

**Alternativas que fallaron:**
- `ArrowRight`: navega dentro del visor de fotos, pero no en el orden del perfil → solo capturaba 2 items
- `data-photo-bucket-id`: el atributo existe pero el click no producía cambio de URL consistente → 2 items

**Solución definitiva:** Leer `extension/content.js` — los botones "Foto N de M" están siempre en el DOM. Click por cursor, sin goBack.

---

### ❌ Error 4 — Loop esperaba 11 items pero el perfil solo tiene 10

**Qué pasó:** El script tenía `items.length < 11` como condición de parada. El perfil tiene exactamente 10 fotos, así que al intentar acceder al índice 10 el array estaba vacío → `break` prematuro.

**Solución:** Usar `playwright codegen` + verificación manual para confirmar cuántas fotos hay. Definir `MAX_ITEMS = 10` como constante explícita.

---

### ❌ Error 5 — Cierre accidental del navegador

Si el usuario hace click o mueve el foco al navegador de Playwright mientras el script corre, el navegador puede cerrarse y el script falla con:

```
Target page, context or browser has been closed
```

**Regla:** No interactuar con el navegador Chromium que abre el script. Esperar a que termine solo.

---

## Estado final del script

| Campo | Fuente | Cuándo se captura |
|---|---|---|
| `url` | `page.url()` estabilizada | Después de `waitForUrlChange` + `waitForUrlStable` |
| `imageUrl` | `allThumbnailSrcs[cursor]` | Antes del loop (snapshot del perfil) |
| `coordinates` | Regex `/@lat,lng/` sobre la URL | Al mismo tiempo que `url` |
| `capturedAt` | `new Date().toISOString()` | Al guardar el item |

**Constante `MAX_ITEMS`:** ajustar según el número real de fotos del perfil.
