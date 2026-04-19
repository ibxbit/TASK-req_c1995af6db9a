import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const WORKSTATION_KEY = 'roadshowops.workstation';
const TOKEN_KEY = 'roadshowops.token';

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeFetchMock(status, body) {
  return vi.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(JSON.stringify(body))
  });
}

describe('getWorkstation', () => {
  it('generates and caches a workstation id', async () => {
    const { getWorkstation } = await import('./api.js');
    const ws = getWorkstation();
    expect(typeof ws).toBe('string');
    expect(ws.startsWith('browser-')).toBe(true);
    expect(getWorkstation()).toBe(ws); // same value on second call
  });

  it('returns stored value if already set', async () => {
    localStorage.setItem(WORKSTATION_KEY, 'my-station');
    const { getWorkstation } = await import('./api.js');
    expect(getWorkstation()).toBe('my-station');
  });
});

describe('setWorkstation', () => {
  it('stores value in localStorage', async () => {
    const { setWorkstation } = await import('./api.js');
    setWorkstation('ws-123');
    expect(localStorage.getItem(WORKSTATION_KEY)).toBe('ws-123');
  });

  it('removes value when called with falsy', async () => {
    localStorage.setItem(WORKSTATION_KEY, 'old');
    const { setWorkstation } = await import('./api.js');
    setWorkstation(null);
    expect(localStorage.getItem(WORKSTATION_KEY)).toBeNull();
  });
});

describe('api()', () => {
  it('sends Authorization header when token is stored', async () => {
    localStorage.setItem(TOKEN_KEY, 'test-jwt');
    const fetchMock = makeFetchMock(200, { ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./api.js');

    await api('/test');
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers['Authorization']).toBe('Bearer test-jwt');
  });

  it('omits Authorization header when no token', async () => {
    const fetchMock = makeFetchMock(200, { data: true });
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./api.js');

    await api('/test');
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers['Authorization']).toBeUndefined();
  });

  it('sends X-Workstation header', async () => {
    const fetchMock = makeFetchMock(200, {});
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./api.js');

    await api('/test');
    const [, opts] = fetchMock.mock.calls[0];
    expect(typeof opts.headers['X-Workstation']).toBe('string');
  });

  it('serialises body as JSON for POST', async () => {
    const fetchMock = makeFetchMock(201, { id: 1 });
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./api.js');

    await api('/items', { method: 'POST', body: { sku: 'X', name: 'Y' } });
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.method).toBe('POST');
    expect(opts.body).toBe(JSON.stringify({ sku: 'X', name: 'Y' }));
  });

  it('throws on non-ok response with error message', async () => {
    const fetchMock = makeFetchMock(400, { error: 'bad input' });
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./api.js');

    await expect(api('/bad')).rejects.toThrow('bad input');
  });

  it('calls clearSession on 401', async () => {
    localStorage.setItem(TOKEN_KEY, 'old-token');
    const fetchMock = makeFetchMock(401, { error: 'unauthorized' });
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./api.js');

    await expect(api('/protected')).rejects.toMatchObject({ status: 401 });
    // After 401, token should be cleared
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('returns parsed data on success', async () => {
    const fetchMock = makeFetchMock(200, [{ id: 1 }, { id: 2 }]);
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./api.js');

    const result = await api('/items');
    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
  });
});
