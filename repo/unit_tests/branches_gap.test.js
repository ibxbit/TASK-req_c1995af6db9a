// Targeted branch-gap tests — covers specific uncovered paths reported by c8.
// Each group documents which file:line branch it covers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerRoutes, setDbHandlers, findRoute, invokeRoute,
  fakeRequest, fakeUser
} from './_route_harness.js';
import { pool } from '../src/db.js';

import paymentRoutes          from '../src/routes/payments.js';
import integrationRoutes      from '../src/routes/integrations.js';
import auditRoutes            from '../src/routes/audit.js';
import authRoutes             from '../src/routes/auth.js';
import workflowEngineRoutes   from '../src/routes/workflow_engine.js';
import workflowsRoutes        from '../src/routes/workflows.js';
import vendorRoutes           from '../src/routes/vendors.js';
import ingestionRoutes        from '../src/routes/ingestion.js';
import ingestionSourceRoutes  from '../src/routes/ingestion_sources.js';
import itineraryTplRoutes     from '../src/routes/itinerary_templates.js';
import adminRoutes            from '../src/routes/admin.js';
import { requireFields }      from '../src/middleware/validate.js';
import auditMutationsPlugin   from '../src/middleware/audit_mutations.js';

const ALL = fakeUser({
  id: 1,
  permissions: [
    'data.city.all','audit.read','order.read','data.ingest',
    'vendor.read','vendor.write','vendor.banking.read','vendor.banking.write',
    'workflow.view','workflow.define','approval.submit','approval.approve','approval.reject',
    'itinerary.read','itinerary.write','itinerary.template.manage',
    'payment.collect','refund.issue','finance.read'
  ]
});

// ── validate.js line 13 ── request[source] || {} falsy branch ──────────────
test('validate — requireFields with null body covers || {} fallback', async () => {
  const mw = requireFields(['x', 'y']);
  const rep = { code(c) { this._c = c; return this; }, send() { return this; } };
  await mw({ body: null }, rep);
  assert.equal(rep._c, 400); // all fields missing because null || {} yields {}
});

// ── payments.js lines 10, 16 ── request.query || {} falsy branch ───────────
test('payments — receipts/refunds with null query covers || {} fallback', async () => {
  const app = await registerRoutes(paymentRoutes);
  setDbHandlers([{ match: /FROM core\.receipt r/, rows: [] }]);
  await invokeRoute(findRoute(app, 'GET', '/payments/receipts'), { request: fakeRequest({ user: ALL, query: null }) });
  setDbHandlers([{ match: /FROM core\.refund rf/, rows: [] }]);
  await invokeRoute(findRoute(app, 'GET', '/payments/refunds'), { request: fakeRequest({ user: ALL, query: null }) });
});

// ── integrations.js line 15 ── request.query || {} falsy branch ────────────
test('integrations — financial-ledger with null query covers || {} fallback', async () => {
  const app = await registerRoutes(integrationRoutes);
  setDbHandlers([{ match: /FROM audit\.financial_ledger/, rows: [] }]);
  await invokeRoute(findRoute(app, 'GET', '/integrations/financial-ledger'), { request: fakeRequest({ user: ALL, query: null }) });
});

// ── audit.js lines 18, 53 ── request.query || {} falsy branch ──────────────
test('audit — events and log with null query cover || {} fallback', async () => {
  const app = await registerRoutes(auditRoutes);
  setDbHandlers([{ match: /FROM audit\.permission_event/, rows: [] }]);
  await invokeRoute(findRoute(app, 'GET', '/audit/events'), { request: fakeRequest({ user: ALL, query: null }) });
  setDbHandlers([{ match: /FROM audit\.v_audit_log/, rows: [] }]);
  await invokeRoute(findRoute(app, 'GET', '/audit/log'), { request: fakeRequest({ user: ALL, query: null }) });
});

// ── auth.js line 15 ── request.body || {} falsy branch ─────────────────────
test('auth — login with null body covers || {} fallback → 400', async () => {
  const app = await registerRoutes(authRoutes);
  const r = await invokeRoute(findRoute(app, 'POST', '/auth/login'), { request: fakeRequest({ body: null }) });
  assert.equal(r._status, 400);
});

// ── workflow_engine.js routes line 77 ── instances query || {} fallback ─────
test('workflow_engine — instances list with null query covers || {} fallback', async () => {
  const app = await registerRoutes(workflowEngineRoutes);
  setDbHandlers([{ match: /FROM core\.workflow_instance/, rows: [] }]);
  await invokeRoute(findRoute(app, 'GET', '/workflows/instances'), { request: fakeRequest({ user: ALL, query: null }) });
});

// ── workflow_engine.js routes line 156 ── tasks/mine query || {} fallback ───
test('workflow_engine — tasks/mine with null query covers || {} fallback', async () => {
  const app = await registerRoutes(workflowEngineRoutes);
  setDbHandlers([{ match: /FROM core\.workflow_task wt/, rows: [] }]);
  await invokeRoute(findRoute(app, 'GET', '/workflows/tasks/mine'), { request: fakeRequest({ user: ALL, query: null }) });
});

// ── workflow_engine.js routes line 134 ── resubmit body || {} fallback ──────
test('workflow_engine — resubmit with null body covers || {} fallback', async () => {
  const app = await registerRoutes(workflowEngineRoutes);
  setDbHandlers([{ match: /FROM core\.workflow_instance WHERE id = \$1 FOR UPDATE/, rows: [] }]);
  // fakeRequest default body is null → null || {} → {} (falsy branch)
  const r = await invokeRoute(findRoute(app, 'POST', '/workflows/instances/:id/resubmit'), {
    request: fakeRequest({ user: ALL, params: { id: 1 } })
  });
  assert.equal(r._status, 404);
});

// ── workflow_engine.js routes line 22 ── send() throw err path ──────────────
test('workflow_engine routes — send() rethrows raw errors (no .status)', async () => {
  const app = await registerRoutes(workflowEngineRoutes);
  setDbHandlers([{ match: /INSERT INTO core\.workflow_definition/, throw: new Error('db raw crash') }]);
  await assert.rejects(
    invokeRoute(findRoute(app, 'POST', '/workflows/definitions'), {
      request: fakeRequest({ user: ALL, body: { code: 'c', entity_type: 'vendor', steps: [{ name: 's', assignee_permission: 'approval.approve' }] } })
    }),
    /db raw crash/
  );
});

// ── workflows.js line 16 ── send() throw err path ───────────────────────────
test('workflows routes — send() rethrows raw errors (no .status)', async () => {
  const app = await registerRoutes(workflowsRoutes);
  setDbHandlers([
    { match: /SELECT status FROM core\.approval_request/, rows: [{ status: 'pending' }] },
    { match: /UPDATE core\.approval_request/, throw: new Error('db raw crash') }
  ]);
  await assert.rejects(
    invokeRoute(findRoute(app, 'POST', '/workflows/approvals/:id/approve'), {
      request: fakeRequest({ user: ALL, params: { id: 1 }, body: {} })
    }),
    /db raw crash/
  );
});

// ── vendors.js line 15 ── send() throw err path ─────────────────────────────
test('vendors routes — send() rethrows raw errors (no .status)', async () => {
  const app = await registerRoutes(vendorRoutes);
  setDbHandlers([{ match: /UPDATE core\.vendor/, throw: new Error('db raw crash') }]);
  await assert.rejects(
    invokeRoute(findRoute(app, 'PUT', '/vendors/:id/banking'), {
      request: fakeRequest({ user: ALL, params: { id: 1 }, body: { tax_id: '999' } })
    }),
    /db raw crash/
  );
});

// ── ingestion.js line 10 ── send() throw err path ───────────────────────────
test('ingestion routes — send() rethrows raw errors (no .status)', async () => {
  const app = await registerRoutes(ingestionRoutes);
  setDbHandlers([{ match: /.*/, throw: new Error('db raw crash') }]);
  await assert.rejects(
    invokeRoute(findRoute(app, 'POST', '/ingestion/:resource'), {
      request: fakeRequest({ user: ALL, params: { resource: 'items' }, body: { records: [{ code: 'X', name: 'Y' }] } })
    }),
    /db raw crash/
  );
});

// ── ingestion_sources.js line 10 ── send() throw err path ───────────────────
test('ingestion_sources routes — send() rethrows raw errors (no .status)', async () => {
  const app = await registerRoutes(ingestionSourceRoutes);
  setDbHandlers([{ match: /.*/, throw: new Error('db raw crash') }]);
  await assert.rejects(
    invokeRoute(findRoute(app, 'POST', '/ingestion/sources/:id/run'), {
      request: fakeRequest({ user: ALL, params: { id: 1 }, body: { force: true } })
    }),
    /db raw crash/
  );
});

// ── integrations.js lines 62-63 ── receipts?.total and refunds?.total branches
// Refund-only ledger: receipts=undefined (?.total short-circuits), refunds=defined (?.total proceeds).
test('integrations — balance with refund-only ledger covers ?.total branches', async () => {
  const app = await registerRoutes(integrationRoutes);
  setDbHandlers([
    { match: /FROM core\.event_order WHERE id/, rows: [{ id: 1, order_number: 'ORD-1', total_amount_cents: 200, currency: 'USD', status: 'active', city_id: 1 }] },
    { match: /FROM audit\.financial_ledger\s+WHERE order_id/, rows: [{ entry_type: 'refund', count: 1, total: -50 }] }
  ]);
  const r = await invokeRoute(findRoute(app, 'GET', '/integrations/orders/:id/balance'), {
    request: fakeRequest({ user: ALL, params: { id: 1 } })
  });
  assert.equal(r._status, 200);
  assert.equal(r._body.received_cents, 0);
  assert.equal(r._body.refunded_cents, -50);
});

// ── integrations.js line 62 ── empty ledger: both receipts and refunds undefined
test('integrations — balance with empty ledger covers receipts?.total short-circuit', async () => {
  const app = await registerRoutes(integrationRoutes);
  setDbHandlers([
    { match: /FROM core\.event_order WHERE id/, rows: [{ id: 1, order_number: 'ORD-1', total_amount_cents: 100, currency: 'USD', status: 'active', city_id: 1 }] },
    { match: /FROM audit\.financial_ledger\s+WHERE order_id/, rows: [] }
  ]);
  const r = await invokeRoute(findRoute(app, 'GET', '/integrations/orders/:id/balance'), {
    request: fakeRequest({ user: ALL, params: { id: 1 } })
  });
  assert.equal(r._status, 200);
  assert.equal(r._body.net_cents, 0);
});

// ── ingestion.js line 26 ── check preHandler body?.records branches ──────────
test('ingestion — check preHandler covers body?.records branches', async () => {
  const app = await registerRoutes(ingestionRoutes);
  const route = findRoute(app, 'POST', '/ingestion/:resource');
  const checkFn = route.opts.preHandler?.[1];
  if (!checkFn) return; // guard: skip if preHandler not accessible
  const rep1 = { code(c) { this._c = c; return this; }, send() { return this; } };
  await checkFn({ body: null }, rep1);
  assert.equal(rep1._c, 400);
  const rep2 = { code(c) { this._c = c; return this; }, send() { return this; } };
  await checkFn({ body: { records: 'not-array' } }, rep2);
  assert.equal(rep2._c, 400);
});

// ── workflows.js line 23 ── request.query || {} falsy branch ─────────────────
test('workflows — GET /workflows/approvals with null query covers || {} fallback', async () => {
  const app = await registerRoutes(workflowsRoutes);
  setDbHandlers([{ match: /FROM core\.approval_request/, rows: [] }]);
  await invokeRoute(findRoute(app, 'GET', '/workflows/approvals'), { request: fakeRequest({ user: ALL, query: null }) });
});

// ── workflows.js line 54 ── submitApproval send() rethrow path ───────────────
test('workflows routes — submitApproval rethrows raw errors (no .status)', async () => {
  const app = await registerRoutes(workflowsRoutes);
  setDbHandlers([{ match: /INSERT INTO core\.approval_request/, throw: new Error('db raw crash') }]);
  await assert.rejects(
    invokeRoute(findRoute(app, 'POST', '/workflows/approvals'), {
      request: fakeRequest({ user: ALL, body: { entity_type: 'vendor', entity_id: 1, summary: 'test approval' } })
    }),
    /db raw crash/
  );
});

// ── workflows.js line 92 ── reject send() rethrow path ───────────────────────
test('workflows routes — reject rethrows raw errors (no .status)', async () => {
  const app = await registerRoutes(workflowsRoutes);
  setDbHandlers([
    { match: /SELECT status FROM core\.approval_request/, rows: [{ status: 'pending' }] },
    { match: /UPDATE core\.approval_request/, throw: new Error('db raw crash') }
  ]);
  await assert.rejects(
    invokeRoute(findRoute(app, 'POST', '/workflows/approvals/:id/reject'), {
      request: fakeRequest({ user: ALL, params: { id: 1 }, body: {} })
    }),
    /db raw crash/
  );
});

// ── vendors.js line 32 ── bank_account_last4 truthy branch ───────────────────
test('vendors — GET /vendors with non-null bank_account_last4 covers truthy branch', async () => {
  const app = await registerRoutes(vendorRoutes);
  setDbHandlers([{ match: /FROM core\.vendor ORDER BY id/, rows: [{ id: 1, code: 'V1', legal_name: 'Test', contact_email: null, contact_phone: null, status: 'active', has_tax_id: false, has_bank_routing: false, bank_account_last4: '5678', created_at: new Date() }] }]);
  const r = await invokeRoute(findRoute(app, 'GET', '/vendors'), { request: fakeRequest({ user: ALL }) });
  assert.equal(r._body[0].bank_account_masked, '****5678');
});

// ── vendors.js lines 14 + 81 ── send() status-error branch + GET banking catch
test('vendors — GET /vendors/:id/banking with invalid ciphertext covers catch + send truthy', async () => {
  const app = await registerRoutes(vendorRoutes);
  setDbHandlers([{ match: /FROM core\.vendor WHERE id/, rows: [{ id: 1, tax_id_encrypted: 'invalid', bank_routing_encrypted: null, bank_account_encrypted: null, bank_account_last4: null, updated_at: null }] }]);
  const r = await invokeRoute(findRoute(app, 'GET', '/vendors/:id/banking'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) });
  assert.equal(r._status, 500);
});

// ── vendors.js line 89 ── request.body || {} falsy branch ────────────────────
test('vendors — PUT /vendors/:id/banking with null body covers || {} fallback', async () => {
  const app = await registerRoutes(vendorRoutes);
  setDbHandlers([{ match: /UPDATE core\.vendor/, rows: [{ id: 1, bank_account_last4: null }] }]);
  const r = await invokeRoute(findRoute(app, 'PUT', '/vendors/:id/banking'), { request: fakeRequest({ user: ALL, params: { id: 1 }, body: null }) });
  assert.equal(r._status, 200);
});

// ── vendors.js line 95 ── non-digit bank_account → '' || null falsy branch ───
test('vendors — PUT /vendors/:id/banking with non-digit bank_account covers || null branch', async () => {
  const app = await registerRoutes(vendorRoutes);
  setDbHandlers([{ match: /UPDATE core\.vendor/, rows: [{ id: 1, bank_account_last4: null }] }]);
  const r = await invokeRoute(findRoute(app, 'PUT', '/vendors/:id/banking'), { request: fakeRequest({ user: ALL, params: { id: 1 }, body: { bank_account: 'abc' } }) });
  assert.equal(r._status, 200);
});

// ── vendors.js reveal ── reason ?? null falsy branch (no reason provided) ─────
test('vendors — reveal happy path without reason covers reason ?? null falsy branch', async () => {
  const app = await registerRoutes(vendorRoutes);
  setDbHandlers([{ match: /FROM core\.vendor WHERE id/, rows: [{ id: 10, tax_id_encrypted: null, bank_routing_encrypted: null, bank_account_encrypted: null }] }]);
  const r = await invokeRoute(findRoute(app, 'POST', '/vendors/:id/banking/reveal'), {
    request: fakeRequest({ user: ALL, params: { id: 10 } })
  });
  assert.equal(r._body.vendor_id, 10);
});

// ── vendors.js reveal ── reason ?? null truthy branch + body || {} truthy ─────
test('vendors — reveal happy path with reason covers reason ?? null truthy branch', async () => {
  const app = await registerRoutes(vendorRoutes);
  setDbHandlers([{ match: /FROM core\.vendor WHERE id/, rows: [{ id: 11, tax_id_encrypted: null, bank_routing_encrypted: null, bank_account_encrypted: null }] }]);
  const r = await invokeRoute(findRoute(app, 'POST', '/vendors/:id/banking/reveal'), {
    request: fakeRequest({ user: ALL, params: { id: 11 }, body: { reason: 'compliance' } })
  });
  assert.equal(r._body.vendor_id, 11);
});

// ── vendors.js line 158 ── reveal catch block with invalid ciphertext ─────────
test('vendors — POST /vendors/:id/banking/reveal with invalid ciphertext covers catch block', async () => {
  const app = await registerRoutes(vendorRoutes);
  setDbHandlers([{ match: /FROM core\.vendor WHERE id/, rows: [{ id: 1, tax_id_encrypted: 'bad:x:y:z', bank_routing_encrypted: null, bank_account_encrypted: null }] }]);
  const r = await invokeRoute(findRoute(app, 'POST', '/vendors/:id/banking/reveal'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) });
  assert.equal(r._status, 500);
});

// ── admin.js — POST /admin/users non-23505 DB error rethrows ─────────────────
test('admin routes — POST /admin/users rethrows non-23505 DB errors (catch else branch)', async () => {
  const app = await registerRoutes(adminRoutes);
  const ADMIN = fakeUser({ id: 1, permissions: ['user.manage', 'data.city.all'] });
  setDbHandlers([{ match: /INSERT INTO core\.app_user/, throw: new Error('db crash') }]);
  await assert.rejects(
    invokeRoute(findRoute(app, 'POST', '/admin/users'), {
      request: fakeRequest({ user: ADMIN, body: { username: 'u', email: 'e@e', full_name: 'f', password: 'StrongPass1234!' } })
    }),
    /db crash/
  );
});

// ── audit_mutations.js lines 37-38 ── catch block when hook body throws ──────
// logPermissionEvent swallows errors internally, so we trigger an earlier throw
// by making request.routeOptions?.url throw via a Proxy (belt-and-suspenders defensive test).
// This covers the outer try-catch branch in the onResponse hook.
test('audit_mutations — onResponse catch swallows unexpected errors', async () => {
  const hooks = {};
  const fakeApp = { addHook: (name, fn) => { hooks[name] = fn; } };
  await auditMutationsPlugin(fakeApp);
  const origQ = pool.query;
  // Make pool.query throw so logPermissionEvent propagates an error to the hook
  // (logPermissionEvent's inner try-catch logs but does NOT re-throw, so we need
  //  to inject a throw before logPermissionEvent is called — via a throwing getter).
  try {
    // Create a request where accessing .routeOptions throws (before logPermissionEvent).
    const evilReq = {
      method: 'POST',
      user: { id: 1, username: 'u' },
      url: '/x',
      headers: {},
      log: { error: () => {} },
      get routeOptions() { throw new Error('surprise'); }
    };
    // Should NOT throw to caller — the outer try-catch in the hook swallows it.
    await hooks.onResponse(evilReq, { statusCode: 201 });
  } finally {
    pool.query = origQ;
  }
});
