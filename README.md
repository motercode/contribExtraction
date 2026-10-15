# contribExtraction

Aplicación local con Node.js, Express y Playwright para abrir un navegador visible de Google Maps, permitir el inicio de sesión manual si Google lo solicita, navegar a un perfil público de contribuciones y exportar los resultados a `contribuciones.json`.

## Requisitos

- Node.js 18 o superior
- navegador Chrome/Chromium disponible para Playwright

## Instalación

```bash
npm install
npx playwright install chromium
```

## Ejecutar la app

```bash
npm start
```

Abre la URL local:

```text
http://localhost:3000
```

## Flujo recomendado

1. Pulsa "Abrir navegador".
2. Si Google muestra el consentimiento de cookies, la app intenta pulsar automáticamente "Rechazar todo" (o "Aceptar todo" como respaldo).
3. Si Google pide iniciar sesión, haz el login manualmente dentro del navegador visible.
4. Pega una URL pública de Google Maps del perfil o contribuciones que quieras recopilar.
5. Pulsa "Extraer contribuciones".
6. La app hace scroll progresivo y guarda los resultados en `contribuciones.json` en la raíz del proyecto.

## Nota importante

La aplicación solo usa navegación real del navegador controlado por Playwright y guarda una sesión persistente en `browser-profile/` para que el usuario pueda hacer login manualmente dentro del navegador visible sin perder la sesión.

No intenta evitar CAPTCHA, autenticación, políticas de Google ni restricciones de acceso.

Cuando quieras validar el servidor en un entorno sin GUI, puedes arrancarlo con:

```bash
PLAYWRIGHT_HEADLESS=true npm start
```
