import { getToken, clearSession } from './session.js';

const BASE = '/api';
const WORKSTATION_KEY = 'roadshowops.workstation';

export function getWorkstation() {
  let ws = localStorage.getItem(WORKSTATION_KEY);
  if (!ws) {
    ws = `browser-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(WORKSTATION_KEY, ws);
  }
  return ws;
}

export function setWorkstation(value) {
  if (value) localStorage.setItem(WORKSTATION_KEY, value);
  else localStorage.removeItem(WORKSTATION_KEY);
}

export async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Workstation': getWorkstation(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (res.status === 401) clearSession();

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw Object.assign(new Error(data?.error || res.statusText), { status: res.status, data });
  return data;
}
