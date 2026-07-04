// utils/api.js

const BASE = '/api';

// Parse a fetch Response safely — never throws "Unexpected end of JSON input".
// Reads the body as text first so we always have something meaningful to show.
async function parseResponse(res) {
  const text = await res.text();

  if (!text) {
    // Empty body — synthesise a readable error
    throw new Error(`Server returned an empty response (HTTP ${res.status})`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    // Body is non-JSON (HTML error page, plain text, etc.)
    const preview = text.slice(0, 120).replace(/\s+/g, ' ');
    throw new Error(`Server returned non-JSON response (HTTP ${res.status}): ${preview}`);
  }

  if (!res.ok) {
    throw new Error(data.error || `Request failed with HTTP ${res.status}`);
  }

  return data;
}

async function post(endpoint, body) {
  const res = await fetch(`${BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseResponse(res);
}

async function get(endpoint) {
  const res = await fetch(`${BASE}${endpoint}`);
  return parseResponse(res);
}

export const api = {
  createSession: (payload)    => post('/session/create', payload),
  verifyCard:    (payload)    => post('/payment/card/verify', payload),
  verifyUpi:     (payload)    => post('/payment/upi/verify', payload),
  cancelSession: (sessionId)  => post(`/session/${sessionId}/cancel`, {}),
  getSession:    (sessionId)  => get(`/session/${sessionId}`),
};
