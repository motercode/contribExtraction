const statusNode = document.getElementById('status');
const openMapsButton = document.getElementById('open-maps');
const captureButton = document.getElementById('capture');
const openJsonButton = document.getElementById('open-json');
const settingsFields = [
  'max-items',
  'gallery-item-delay-ms',
  'scroll-step-delay-ms',
  'url-change-timeout-ms',
  'url-stable-timeout-ms',
  'consent-post-click-delay-ms',
  'gallery-fallback-click-delay-ms'
];

const defaultSettings = {
  maxItems: '200',
  galleryItemDelayMs: '800',
  scrollStepDelayMs: '1200',
  urlChangeTimeoutMs: '12000',
  urlStableTimeoutMs: '5000',
  consentPostClickDelayMs: '1600',
  galleryFallbackClickDelayMs: '1200'
};

const optionSets = {
  'max-items': [50, 100, 200, 500],
  'gallery-item-delay-ms': [400, 800, 1200, 1600],
  'scroll-step-delay-ms': [600, 1000, 1200, 1600],
  'url-change-timeout-ms': [6000, 12000, 18000, 24000],
  'url-stable-timeout-ms': [3000, 5000, 7000, 10000],
  'consent-post-click-delay-ms': [800, 1600, 2400, 3200],
  'gallery-fallback-click-delay-ms': [600, 1200, 1800, 2400]
};

const storageKey = 'extractionSettings';
const logSource = 'popup';

const selectNodes = Object.fromEntries(
  settingsFields.map((fieldId) => [fieldId, document.getElementById(fieldId)])
);

const toCamelKey = (fieldId) => fieldId.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());

const createSessionId = () => {
  if (crypto?.randomUUID) {
    return crypto.randomUUID();
  }

  return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const emitLogEvent = (sessionId, step, data = {}, severity = 'info') => {
  try {
    chrome.runtime.sendMessage(
      {
        type: 'LOG_EVENT',
        payload: {
          source: logSource,
          sessionId,
          step,
          severity,
          data,
          timestamp: new Date().toISOString()
        }
      },
      () => void chrome.runtime.lastError
    );
  } catch {
    // Logging should never block extraction.
  }
};

const setStatus = (message, isError = false) => {
  statusNode.textContent = message;
  statusNode.style.color = isError ? '#a61b1b' : '#1f2937';
};

const populateSelect = (select, values) => {
  select.innerHTML = '';

  for (const value of values) {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = `${value} ms`;
    select.appendChild(option);
  }
};

const populateSettings = () => {
  for (const [fieldId, values] of Object.entries(optionSets)) {
    populateSelect(selectNodes[fieldId], values);
  }
};

const readSettingsFromForm = () => {
  const settings = {};

  for (const fieldId of settingsFields) {
    const camelKey = toCamelKey(fieldId);
    settings[camelKey] = selectNodes[fieldId].value;
  }

  return settings;
};

const applySettingsToForm = (settings = {}) => {
  for (const fieldId of settingsFields) {
    const camelKey = toCamelKey(fieldId);
    const fallbackValue = defaultSettings[camelKey];
    const currentValue = String(settings[camelKey] ?? fallbackValue);
    selectNodes[fieldId].value = currentValue;
  }
};

const saveSettings = async () => {
  await chrome.storage.local.set({ [storageKey]: readSettingsFromForm() });
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
  const sessionId = createSessionId();
  const settings = readSettingsFromForm();

  try {
    await saveSettings();
    emitLogEvent(sessionId, 'capture_requested', { settings });

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      throw new Error('No hay pestaña activa.');
    }

    emitLogEvent(sessionId, 'capture_tab_resolved', { tabId: tab.id, url: tab.url || null });
    setStatus('Recopilando contribuciones desde la pestaña actual…');
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'EXTRACT_CONTRIBUTIONS',
      config: {
        ...settings,
        sessionId
      }
    });

    emitLogEvent(sessionId, 'capture_response_received', {
      ok: Boolean(response?.ok),
      itemCount: Array.isArray(response?.items) ? response.items.length : 0,
      error: response?.error || null
    });

    if (!response || !response.ok) {
      throw new Error(response?.error || 'No se pudo extraer contenido desde esta página.');
    }

    emitLogEvent(sessionId, 'save_export_start', { itemCount: (response.items || []).length });
    const result = await saveToBackend(response.items || []);
    emitLogEvent(sessionId, 'save_export_done', { total: result.total, path: result.path || null });
    setStatus(`Guardado: ${result.total} elementos en contribuciones.json`);
  } catch (error) {
    emitLogEvent(sessionId, 'capture_failed', { error: error.message || String(error) }, 'error');
    setStatus(error.message, true);
  }
});

openJsonButton.addEventListener('click', async () => {
  window.open('http://localhost:3000/contribuciones.json', '_blank');
});

for (const select of Object.values(selectNodes)) {
  select.addEventListener('change', () => {
    void saveSettings();
  });
}

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

populateSettings();
chrome.storage.local.get({ [storageKey]: defaultSettings }).then((result) => {
  applySettingsToForm(result[storageKey]);
});
