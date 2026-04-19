// Route-level RBAC regression matrix for high-sensitivity endpoints.
// Covers 401 (no token), 403 (authenticated but wrong permission),
// 404 (authorized but object absent), and one authorized success path
// per surface, including audit metadata verification for vendor reveal.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, loginAdmin, uniq } from './_helpers.js';

const PASS = 'RbacMatrix_Secure12!';

let adminToken;
let recruiterToken;  // has: workflow.view, venue.read/write, approval.submit
                     // lacks: vendor.banking.read/write, audit.read, user.manage
let warehouseToken;  // has: inventory.read/write/issue
                     // lacks: workflow.view, venue.read/write, vendor.banking.*

before(async () => {
  adminToken = await loginAdmin();

  const rName = uniq('rbac-rec');
  await apiFetch('/admin/users', {
    method: 'POST', token: adminToken,
    body: { username: rName, email: `${rName}@local`, full_name: 'RBAC Rec',
            password: PASS, role_codes: ['RECRUITER'] }
  });
  const rLogin = await apiFetch('/auth/login', {
    method: 'POST', body: { username: rName, password: PASS }
  });
  assert.equal(rLogin.status, 200, `recruiter login: ${JSON.stringify(rLogin.body)}`);
  recruiterToken = rLogin.body.token;

  const wName = uniq('rbac-wh');
  await apiFetch('/admin/users', {
    method: 'POST', token: adminToken,
    body: { username: wName, email: `${wName}@local`, full_name: 'RBAC WH',
            password: PASS, role_codes: ['WAREHOUSE'] }
  });
  const wLogin = await apiFetch('/auth/login', {
    method: 'POST', body: { username: wName, password: PASS }
  });
  assert.equal(wLogin.status, 200, `warehouse login: ${JSON.stringify(wLogin.body)}`);
  warehouseToken = wLogin.body.token;
});

// ============================================================================
// Workflow instances
// ============================================================================
test('GET /workflows/instances — 401 without token', async () => {
  const r = await apiFetch('/workflows/instances');
  assert.equal(r.status, 401);
});

test('GET /workflows/instances — 403 without workflow.view (WAREHOUSE)', async () => {
  const r = await apiFetch('/workflows/instances', { token: warehouseToken });
  assert.equal(r.status, 403);
});

test('GET /workflows/instances/:id — 401 without token', async () => {
  const r = await apiFetch('/workflows/instances/1');
  assert.equal(r.status, 401);
});

test('GET /workflows/instances/:id — 403 without workflow.view (WAREHOUSE)', async () => {
  const r = await apiFetch('/workflows/instances/1', { token: warehouseToken });
  assert.equal(r.status, 403);
});

// ============================================================================
// Drive-time
// ============================================================================
test('GET /venues/drive-time — 401 without token', async () => {
  const r = await apiFetch('/venues/drive-time?origin=1&destination=2');
  assert.equal(r.status, 401);
});

test('GET /venues/drive-time — 403 without venue.read (WAREHOUSE)', async () => {
  const r = await apiFetch('/venues/drive-time?origin=1&destination=2', { token: warehouseToken });
  assert.equal(r.status, 403);
});

test('POST /venues/drive-time — 401 without token', async () => {
  const r = await apiFetch('/venues/drive-time', {
    method: 'POST', body: { origin_venue_id: 1, destination_venue_id: 2, minutes: 30 }
  });
  assert.equal(r.status, 401);
});

test('POST /venues/drive-time — 403 without venue.write (WAREHOUSE)', async () => {
  const r = await apiFetch('/venues/drive-time', {
    method: 'POST', token: warehouseToken,
    body: { origin_venue_id: 1, destination_venue_id: 2, minutes: 30 }
  });
  assert.equal(r.status, 403);
});

// ============================================================================
// Vendor banking reveal (POST /vendors/:id/banking/reveal)
// requires vendor.banking.read — only FINANCE and ADMIN
// ============================================================================
test('POST /vendors/:id/banking/reveal — 401 without token', async () => {
  const r = await apiFetch('/vendors/1/banking/reveal', { method: 'POST' });
  assert.equal(r.status, 401);
});

test('POST /vendors/:id/banking/reveal — 403 without vendor.banking.read (RECRUITER)', async () => {
  const r = await apiFetch('/vendors/1/banking/reveal', { method: 'POST', token: recruiterToken });
  assert.equal(r.status, 403);
});

test('POST /vendors/:id/banking/reveal — 404 for non-existent vendor id', async () => {
  const r = await apiFetch('/vendors/999999999/banking/reveal', {
    method: 'POST', token: adminToken
  });
  assert.equal(r.status, 404);
});

// Authorized reveal: correct fields only + reason captured in audit metadata.
test('POST /vendors/:id/banking/reveal — 200 with expected fields; reason in audit', async () => {
  // Create and populate a vendor
  const vc = await apiFetch('/vendors', {
    method: 'POST', token: adminToken,
    body: { code: uniq('RBAC-VND'), legal_name: 'RBAC Matrix Vendor' }
  });
  assert.equal(vc.status, 201, JSON.stringify(vc.body));
  const vendorId = vc.body.id;

  await apiFetch(`/vendors/${vendorId}/banking`, {
    method: 'PUT', token: adminToken,
    body: { tax_id: '12-3456789', bank_routing: '021000021', bank_account: '9876543210' }
  });

  const reveal = await apiFetch(`/vendors/${vendorId}/banking/reveal`, {
    method: 'POST', token: adminToken,
    body: { reason: 'annual compliance review' }
  });
  assert.equal(reveal.status, 200, JSON.stringify(reveal.body));

  // Response must contain exactly these four fields — no internal DB columns
  const keys = Object.keys(reveal.body).sort();
  assert.deepEqual(keys, ['bank_account', 'bank_routing', 'tax_id', 'vendor_id'],
    `unexpected fields in reveal response: ${JSON.stringify(keys)}`);
  assert.equal(Number(reveal.body.vendor_id), Number(vendorId));

  // Verify audit event captured reason in metadata
  const audit = await apiFetch('/admin/audit?limit=500', { token: adminToken });
  assert.equal(audit.status, 200);
  const event = audit.body.find(
    e => e.action === 'vendor.banking.reveal' &&
         e.resource === `vendor:${vendorId}:banking`
  );
  assert.ok(event, 'audit event vendor.banking.reveal must exist');
  const meta = typeof event.metadata === 'string'
    ? JSON.parse(event.metadata) : event.metadata;
  assert.equal(meta?.reason, 'annual compliance review',
    `audit metadata.reason mismatch; got ${JSON.stringify(meta)}`);
  assert.ok(Array.isArray(meta?.revealed_fields),
    'audit metadata.revealed_fields must be an array');
});

// ============================================================================
// Vendor banking update (PUT /vendors/:id/banking)
// requires vendor.banking.write — only FINANCE and ADMIN
// ============================================================================
test('PUT /vendors/:id/banking — 401 without token', async () => {
  const r = await apiFetch('/vendors/1/banking', { method: 'PUT' });
  assert.equal(r.status, 401);
});

test('PUT /vendors/:id/banking — 403 without vendor.banking.write (RECRUITER)', async () => {
  const r = await apiFetch('/vendors/1/banking', {
    method: 'PUT', token: recruiterToken, body: { tax_id: '99-9999999' }
  });
  assert.equal(r.status, 403);
});

// ============================================================================
// Admin audit + users (already covered in rbac.test.js; 401 cases added here)
// ============================================================================
test('GET /admin/audit — 401 without token', async () => {
  const r = await apiFetch('/admin/audit');
  assert.equal(r.status, 401);
});

test('GET /admin/users — 401 without token', async () => {
  const r = await apiFetch('/admin/users');
  assert.equal(r.status, 401);
});

test('GET /admin/audit — 403 without audit.read (RECRUITER)', async () => {
  const r = await apiFetch('/admin/audit', { token: recruiterToken });
  assert.equal(r.status, 403);
});

test('GET /admin/users — 403 without user.manage (RECRUITER)', async () => {
  const r = await apiFetch('/admin/users', { token: recruiterToken });
  assert.equal(r.status, 403);
});
