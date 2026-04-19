// Lightweight Postgres-client fakes for unit tests.
//
// These never touch a real database. Two styles are supported:
//
//   (1) Regex-routed client:
//         const client = makeClient([
//           { match: /FROM core\.event_order/, rows: [{ id: 1, city_id: 2 }] },
//           { match: /INSERT INTO core\.payment_stage/, rows: [{ id: 11 }] },
//           { match: /.*/, rows: [] }   // catch-all
//         ]);
//
//   (2) Scripted client (returns rows in order queries fire):
//         const client = scriptedClient([
//           [{ id: 1 }], [{ id: 11 }], []
//         ]);
//
// Both expose an async `query(sql, params)` that returns { rows } and tracks
// calls on `.calls` for assertions.

export function makeClient(handlers = []) {
  const calls = [];
  const client = {
    calls,
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      for (const h of handlers) {
        const m = h.match;
        const matches =
          m instanceof RegExp ? m.test(sql) :
          typeof m === 'function' ? m(sql, params) :
          typeof m === 'string' ? sql.includes(m) :
          false;
        if (matches) {
          const rows = typeof h.rows === 'function' ? h.rows(params, sql) : h.rows;
          if (h.throw) throw h.throw;
          return { rows: rows ?? [], rowCount: (rows ?? []).length };
        }
      }
      throw new Error(`[fake-db] no handler matched SQL: ${sql.slice(0, 120)}`);
    }
  };
  return client;
}

export function scriptedClient(responses = []) {
  const calls = [];
  let i = 0;
  return {
    calls,
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (i >= responses.length) {
        throw new Error(
          `[fake-db] script exhausted at call ${i}: ${sql.slice(0, 120)}`
        );
      }
      const r = responses[i++];
      if (r && r.throw) throw r.throw;
      const rows = Array.isArray(r) ? r : (r?.rows ?? []);
      return { rows, rowCount: rows.length };
    }
  };
}

// Build a permission set from a list of codes.
export const perms = (...codes) => new Set(codes);

// Build a fake user.
export function fakeUser({ id = 1, username = 'u', permissions = [], assignedCityIds = [] } = {}) {
  return {
    id, username, full_name: 'Test',
    permissions: permissions instanceof Set ? permissions : new Set(permissions),
    assignedCityIds: [...assignedCityIds]
  };
}

// Fake Fastify reply.
export function fakeReply() {
  const r = {
    _status: 200,
    _body: undefined,
    _headers: {},
    code(n) { r._status = n; return r; },
    send(body) { r._body = body; return r; },
    header(k, v) { r._headers[k] = v; return r; }
  };
  return r;
}

// Fake Fastify request.
export function fakeRequest({ user, params = {}, query = {}, body = null, headers = {} } = {}) {
  return {
    user,
    params, query, body,
    headers,
    method: 'GET',
    url: '/'
  };
}

// Fake Fastify app — collects registered routes so we can drive handlers directly.
export function fakeApp() {
  const routes = [];
  const app = {
    routes,
    _make(method) {
      return (path, opts, handler) => {
        const h = typeof opts === 'function' ? opts : handler;
        const o = typeof opts === 'function' ? {} : opts;
        routes.push({ method, path, opts: o, handler: h });
      };
    },
    get:  undefined, post: undefined, put: undefined, del: undefined, delete: undefined, patch: undefined,
    route(def) { routes.push({ ...def }); }
  };
  app.get    = app._make('GET');
  app.post   = app._make('POST');
  app.put    = app._make('PUT');
  app.del    = app._make('DELETE');
  app.delete = app._make('DELETE');
  app.patch  = app._make('PATCH');
  app.find = (method, pathPattern) =>
    routes.find((r) => r.method === method && (r.path === pathPattern ||
      (pathPattern instanceof RegExp && pathPattern.test(r.path))));
  return app;
}
