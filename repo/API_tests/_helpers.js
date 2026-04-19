// Shared helpers for API tests — runs inside the backend container.
export const BASE = process.env.API_BASE || 'http://localhost:4000';
export const adminUser = process.env.ADMIN_USERNAME || 'admin';
export const adminPass = process.env.ADMIN_PASSWORD || 'RoadshowOpsAdmin1!';

export async function rawFetch(path, { method = 'GET', token, body, headers = {} } = {}) {
  return fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      'X-Workstation': 'test-runner',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
}

export async function apiFetch(path, opts = {}) {
  const res = await rawFetch(path, opts);
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  return { status: res.status, body: data, headers: res.headers };
}

export async function loginAdmin() {
  const { status, body } = await apiFetch('/auth/login', {
    method: 'POST', body: { username: adminUser, password: adminPass }
  });
  if (status !== 200 || !body?.token) {
    throw new Error(`admin login failed: status=${status} body=${JSON.stringify(body)}`);
  }
  return body.token;
}

export const uniq = (prefix) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
