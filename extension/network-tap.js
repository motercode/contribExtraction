// Se ejecuta en el "MAIN world" de la página (manifest: world MAIN, document_start).
// Observa las respuestas de red de Google Maps que contienen imágenes de googleusercontent
// y las reenvía a content.js mediante window.postMessage. No modifica las respuestas.
(() => {
  const TAP_SOURCE = 'contrib-extraction-network-tap';
  const MAX_BODY_CHARS = 500000;

  const forward = (url, body) => {
    if (typeof body !== 'string' || !/googleusercontent\.com/i.test(body)) {
      return;
    }

    window.postMessage(
      {
        source: TAP_SOURCE,
        url: String(url || ''),
        bodyLength: body.length,
        body: body.slice(0, MAX_BODY_CHARS)
      },
      window.location.origin
    );
  };

  const originalFetch = window.fetch;
  window.fetch = async function patchedFetch(...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
      response.clone().text().then((text) => forward(url, text)).catch(() => {});
    } catch {
      // Nunca interferir con la página.
    }
    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function patchedOpen(method, url, ...rest) {
    this.__contribTapUrl = url;
    return originalOpen.call(this, method, url, ...rest);
  };

  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function patchedSend(...args) {
    this.addEventListener('load', () => {
      try {
        if (this.responseType === '' || this.responseType === 'text') {
          forward(this.__contribTapUrl, this.responseText);
        }
      } catch {
        // Nunca interferir con la página.
      }
    });
    return originalSend.apply(this, args);
  };
})();
