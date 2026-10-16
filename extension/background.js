chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ lastResult: [] });
});

const postLogEvent = async (payload = {}) => {
  const response = await fetch('http://localhost:3000/api/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  let result = null;
  try {
    result = await response.json();
  } catch {
    result = null;
  }

  return { ok: response.ok, result };
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'SAVE_EXPORT') {
    fetch('http://localhost:3000/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message.payload)
    })
      .then(async (response) => {
        const result = await response.json();
        sendResponse({ ok: response.ok, result });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: String(error) });
      });

    return true;
  }

  if (message.type === 'LOG_EVENT') {
    postLogEvent(message.payload)
      .then((result) => sendResponse(result))
      .catch((error) => {
        sendResponse({ ok: false, error: String(error) });
      });

    return true;
  }

  return false;
});
