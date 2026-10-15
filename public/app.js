const statusBox = document.getElementById('status');
const preview = document.getElementById('preview');
const countLabel = document.getElementById('last-count');
const urlLabel = document.getElementById('last-url');
const input = document.getElementById('profile-url');

const setStatus = (message, isError = false) => {
  statusBox.textContent = message;
  statusBox.style.borderColor = isError ? '#f8d7da' : '#dfe3ee';
  statusBox.style.background = isError ? '#fff5f5' : '#f6f9ff';
  statusBox.style.color = isError ? '#8a1c1c' : '#1f2937';
};

const renderPreview = (items) => {
  if (!items || items.length === 0) {
    preview.innerHTML = '<p>No hay contribuciones aún.</p>';
    return;
  }

  const fallbackSvg = 'data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22160%22 height=%22130%22%3E%3Cg fill=%22%23e7edf5%22%3E%3Crect width=%22160%22 height=%22130%22 fill=%22%23eef2f7%22/%3E%3Ccircle cx=%2270%22 cy=%2252%22 r=%2234%22 fill=%22%23dfe3ee%22/%3E%3Cpath d=%22M34 90h92L82 52z%22 fill=%22%23dfe3ee%22/%3E%3C/g%3E%3C/svg%3E';

  preview.innerHTML = `
    <div class="preview-list">
      ${items
        .slice(0, 8)
        .map(
          (item) => `
            <article class="preview-item">
              <img src="${item.imageUrl || fallbackSvg}" alt="${(item.title || 'Contribución').replace(/"/g, '&quot;')}" />
              <div class="body">
                <h3>${(item.title || 'Sin título').slice(0, 120)}</h3>
                <p>${(item.text || 'Sin descripción disponible').slice(0, 240)}</p>
                <a href="${item.url || '#'}" target="_blank" rel="noreferrer">Abrir enlace</a>
              </div>
            </article>
          `
        )
        .join('')}
    </div>
  `;
};

const requestJson = async (endpoint, payload) => {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || 'La solicitud falló.');
  }

  return result;
};

document.getElementById('open-browser').addEventListener('click', async () => {
  try {
    setStatus('Abriendo Google Maps en un navegador visible…');
    const result = await requestJson('/api/open-browser', {});
    setStatus(`Navegador listo: ${result.url}`);
  } catch (error) {
    setStatus(error.message, true);
  }
});

document.getElementById('go-to-url').addEventListener('click', async () => {
  const url = input.value.trim();
  if (!url) {
    setStatus('Debes escribir una URL antes de navegar.', true);
    return;
  }

  try {
    setStatus('Navegando a la URL indicada…');
    const result = await requestJson('/api/go-to-url', { url });
    input.value = result.url;
    urlLabel.textContent = result.url;
    setStatus(`Listo: ${result.title || result.url}`);
  } catch (error) {
    setStatus(error.message, true);
  }
});

document.getElementById('extract').addEventListener('click', async () => {
  const url = input.value.trim();
  if (!url) {
    setStatus('Debes introducir una URL válida para extraer contribuciones.', true);
    return;
  }

  try {
    setStatus('Recopilando contribuciones con scroll progresivo…');
    const result = await requestJson('/api/extract', { url });
    urlLabel.textContent = result.url;
    countLabel.textContent = `${result.total} elementos`;
    renderPreview(result.items || []);
    setStatus(`Se guardaron ${result.total} contribuciones en contribuciones.json.`);
  } catch (error) {
    setStatus(error.message, true);
  }
});

fetch('/api/health')
  .then(async (response) => {
    const result = await response.json();
    if (result.ok) {
      setStatus('Servidor listo. Abre Google Maps y autentícate manualmente si es necesario.');
    }
  })
  .catch(() => {
    setStatus('No se pudo conectar con el servidor.', true);
  });
