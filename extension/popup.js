const statusNode = document.getElementById('status');
const openMapsButton = document.getElementById('open-maps');
const captureButton = document.getElementById('capture');
const openJsonButton = document.getElementById('open-json');

const setStatus = (message, isError = false) => {
  statusNode.textContent = message;
  statusNode.style.color = isError ? '#a61b1b' : '#1f2937';
};

const saveToBackend = async (items) => {
  let response;

  try {
    response = await fetch('http://localhost:3000/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items })
    });
  } catch (error) {
    throw new Error('No se pudo contactar con el backend local en http://localhost:3000. Inicia el servidor con "npm start" antes de extraer.');
  }

  let result = null;
  try {
    result = await response.json();
  } catch {
    result = { ok: false, error: 'Respuesta del backend no válida.' };
  }

  if (!response.ok || result?.ok === false) {
    throw new Error(result?.error || 'No se pudo guardar la exportación.');
  }

  return result;
};

openMapsButton.addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://www.google.com/maps' });
});

captureButton.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      throw new Error('No hay pestaña activa.');
    }

    setStatus('Recopilando contribuciones desde la pestaña actual…');
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_CONTRIBUTIONS' });

    if (!response || !response.ok) {
      throw new Error(response?.error || 'No se pudo extraer contenido desde esta página.');
    }

    const result = await saveToBackend(response.items || []);
    setStatus(`Guardado: ${result.total} elementos en contribuciones.json`);
  } catch (error) {
    setStatus(error.message, true);
  }
});

openJsonButton.addEventListener('click', async () => {
  window.open('http://localhost:3000/contribuciones.json', '_blank');
});

chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  if (!tab || !tab.url) {
    setStatus('Abre Google Maps antes de extraer.');
    return;
  }

  if (
    tab.url.includes('google.com/maps')
    || tab.url.includes('maps.google.com')
    || tab.url.includes('consent.google.com')
    || tab.url.includes('continue=https://www.google.com/maps')
  ) {
    setStatus('Listo para extraer contribuciones.');
  } else {
    setStatus('La pestaña actual no parece ser Google Maps.');
  }
});
