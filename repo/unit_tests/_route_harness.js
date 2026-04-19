// Route-handler test harness.
//
// Routes import `pool` and `withTransaction` from db.js. We intercept by
// mutating the exported `pool` object so pool.query and pool.connect return
// controllable fakes. `withTransaction` is implemented as
//   const client = await pool.connect();
//   client.query('BEGIN') ... fn(client) ... 'COMMIT' / 'ROLLBACK' ...
// so by driving pool.connect() we drive withTransaction too.
import { pool } from '../src/db.js';
import { makeClient, fakeReply, fakeRequest, fakeApp, fakeUser } from './_fakes.js';

export { fakeReply, fakeRequest, fakeApp, fakeUser };

let currentHandlers = [];

// Default handlers that every route test inherits — mostly audit log writes
// that happen incidentally on permission checks / mutations.
const DEFAULT_HANDLERS = [
  { match: /INSERT INTO audit\.permission_event/, rows: [] },
  { match: /INSERT INTO audit\.stock_ledger/, rows: [] },
  { match: /INSERT INTO audit\.ingestion_run/, rows: [{ id: 1 }] },
  { match: /INSERT INTO audit\.payment_attempt/, rows: [] },
  { match: /INSERT INTO audit\.financial_ledger/, rows: [] }
];

export function setDbHandlers(handlers) {
  currentHandlers = handlers;
}

function buildFakeClient() {
  return makeClient([...currentHandlers, ...DEFAULT_HANDLERS]);
}

// Intercept pool.query
pool.query = async (sql, params = []) => {
  const c = buildFakeClient();
  return c.query(sql, params);
};

// Intercept pool.connect so withTransaction receives our fake client.
pool.connect = async () => {
  const c = buildFakeClient();
  return {
    ...c,
    query: async (sql, params = []) => {
      // Silence BEGIN/COMMIT/ROLLBACK explicitly so handlers don't need handlers for them.
      if (/^(BEGIN|COMMIT|ROLLBACK)\b/i.test(sql.trim())) return { rows: [] };
      return c.query(sql, params);
    },
    release: () => {}
  };
};

// Prevent pool.end() hanging the test process.
const origEnd = pool.end?.bind(pool);
pool.end = async () => {};

export async function registerRoutes(routeModule) {
  const app = fakeApp();
  await routeModule(app);
  return app;
}

export function findRoute(app, method, pathOrMatcher) {
  return app.find(method, pathOrMatcher) ||
    app.routes.find((r) => r.method === method && (typeof pathOrMatcher === 'function' ? pathOrMatcher(r.path) : r.path === pathOrMatcher));
}

export async function invokeRoute(route, { request, reply }) {
  // Ignoring preHandlers for unit testing — we drive them in separate tests.
  const r = reply ?? fakeReply();
  const result = await route.handler(request, r);
  // Fastify convention: returning a value means reply was not .send()
  if (r._body === undefined && result !== undefined) r._body = result;
  return r;
}

// Mutate the pool connection stub on-the-fly.
export function withDbHandlers(handlers, fn) {
  const prev = currentHandlers;
  currentHandlers = handlers;
  try { return fn(); } finally { currentHandlers = prev; }
}
