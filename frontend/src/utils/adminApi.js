// utils/adminApi.js

const BASE = '/admin';

async function parseResponse(res) {
  const text = await res.text();
  if (!text) throw new Error(`Server returned an empty response (HTTP ${res.status})`);
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(`Non-JSON response (HTTP ${res.status}): ${text.slice(0, 120)}`); }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function get(endpoint) {
  return parseResponse(await fetch(`${BASE}${endpoint}`));
}

async function post(endpoint, body = {}) {
  return parseResponse(await fetch(`${BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

async function del(endpoint) {
  return parseResponse(await fetch(`${BASE}${endpoint}`, { method: 'DELETE' }));
}

export const adminApi = {
  getSessions:     ()           => get('/sessions'),
  getSession:      (id)         => get(`/sessions/${id}`),
  refundSession:   (id, reason) => post(`/sessions/${id}/refund`, { reason }),
  getRefundStatus: (id)         => get(`/sessions/${id}/refund-status`),
  triggerSweep:    ()           => post('/sweep'),
  deleteSession:   (id)         => del(`/sessions/${id}`),
};
