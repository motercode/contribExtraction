// Popup de la rama shortcut: solo el atajo (galería completa por red). Corre en la pestaña;
// el popup solo lo controla y muestra el estado que publica content.js.
const statusNode = document.getElementById('status');
const shortcutStatusNode = document.getElementById('shortcut-status');
const restartCheckbox = document.getElementById('shortcut-restart');
const startButton = document.getElementById('shortcut-start');
const stopButton = document.getElementById('shortcut-stop');
const openButton = document.getElementById('shortcut-open');
const shortcutStatusKey = 'shortcutStatus';
const logSource = 'popup';
let lastUserId = null;

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
    // El log nunca debe bloquear la extracción.
  }
};

const setNodeText = (node, message, isError = false) => {
  node.textContent = message;
  node.style.color = isError ? '#a61b1b' : '#1f2937';
};

const sendToActiveTab = async (message) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error('No hay pestaña activa.');
  }
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    throw new Error('La pestaña no tiene la extensión cargada: recárgala (F5) y vuelve a intentarlo.');
  }
};

const renderShortcutStatus = (status) => {
  if (!status) {
    return;
  }

  lastUserId = status.userId || lastUserId;
  const total = status.profileTotal ? ` de ${status.profileTotal}` : '';
  const state = status.running ? 'En marcha' : `Terminado (${status.finishReason || '—'})`;
  const resumed = status.resumed ? ' · retomado' : '';
  const error = status.lastError ? ` · Error: ${status.lastError}` : '';
  setNodeText(shortcutStatusNode, `${state}: ${status.photos}${total} fotos en ${status.pages} páginas${resumed}${error}`, Boolean(status.lastError));
};

startButton.addEventListener('click', async () => {
  const sessionId = createSessionId();
  try {
    const response = await sendToActiveTab({ type: 'SHORTCUT_START', sessionId, restart: restartCheckbox.checked });
    if (!response?.ok) {
      throw new Error(response?.error || 'No se pudo iniciar.');
    }
    lastUserId = response.userId;
    emitLogEvent(sessionId, 'shortcut_requested', { ...response, restart: restartCheckbox.checked });
    setNodeText(shortcutStatusNode, `Iniciado para ${response.userId} (${response.profileTotal ?? '¿?'} fotos). Puedes cerrar este popup; la pestaña debe seguir abierta y visible.`);
  } catch (error) {
    setNodeText(shortcutStatusNode, error.message || String(error), true);
  }
});

stopButton.addEventListener('click', async () => {
  try {
    await sendToActiveTab({ type: 'SHORTCUT_STOP' });
    setNodeText(shortcutStatusNode, 'Deteniendo… Lo recogido queda guardado; Iniciar / retomar sigue donde se quedó.');
  } catch (error) {
    setNodeText(shortcutStatusNode, error.message || String(error), true);
  }
});

openButton.addEventListener('click', () => {
  if (!lastUserId) {
    setNodeText(shortcutStatusNode, 'Aún no hay resultado: inicia la recogida primero.', true);
    return;
  }
  window.open(`http://localhost:3000/api/shortcut/${lastUserId}/export`, '_blank');
});

chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  const userId = tab?.url?.match(/\/maps\/contrib\/(\d+)/)?.[1];
  lastUserId = lastUserId || userId || null;
  if (userId) {
    setNodeText(statusNode, `Perfil ${userId}. Listo.`);
  } else {
    setNodeText(statusNode, 'La pestaña actual no es la galería de un perfil de Google Maps (/maps/contrib/<id>/photos).', true);
  }
});

chrome.storage.local.get(shortcutStatusKey).then((result) => renderShortcutStatus(result[shortcutStatusKey]));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[shortcutStatusKey]) {
    renderShortcutStatus(changes[shortcutStatusKey].newValue);
  }
});
