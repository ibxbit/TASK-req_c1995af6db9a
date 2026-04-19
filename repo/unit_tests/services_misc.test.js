// Unit tests — services/financial_ledger.js, payments.js, workflows.js,
// ingestion.js, ingestion_hooks.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeClient } from './_fakes.js';
import { recordReceiptEntry, recordRefundEntry } from '../src/services/financial_ledger.js';
import { listReceipts, listRefunds, getStageDetail } from '../src/services/payments.js';
import { submitApproval, decideApproval, cancelApproval, listApprovals, getApproval } from '../src/services/workflows.js';
import { runIngestion, supportedResources } from '../src/services/ingestion.js';
import { defaultHooks, hooks, setHooks } from '../src/services/ingestion_hooks.js';

// ============================================================================
// financial_ledger.js
// ============================================================================
test('recordReceiptEntry requires receipt_id and positive amount', async () => {
  const c = makeClient([{ match: /.*/, rows: [] }]);
  await assert.rejects(() => recordReceiptEntry(c, { amount_cents: 1 }), /receipt_id/);
  await assert.rejects(() => recordReceiptEntry(c, { receipt_id: 1, amount_cents: 0 }), /positive/);
});

test('recordReceiptEntry inserts', async () => {
  const c = makeClient([{ match: /INSERT INTO audit\.financial_ledger/, rows: [] }]);
  await recordReceiptEntry(c, { order_id: 1, payment_stage_id: 1, receipt_id: 1, amount_cents: 100, metadata: { x: 1 } });
});

test('recordRefundEntry requires refund_id + positive amount', async () => {
  const c = makeClient([]);
  await assert.rejects(() => recordRefundEntry(c, { amount_cents: 1 }), /refund_id/);
  await assert.rejects(() => recordRefundEntry(c, { refund_id: 1, amount_cents: -1 }), /positive/);
});

test('recordRefundEntry inserts', async () => {
  const c = makeClient([{ match: /INSERT INTO audit\.financial_ledger/, rows: [] }]);
  await recordRefundEntry(c, { order_id: 1, payment_stage_id: 1, refund_id: 5, amount_cents: 50, metadata: { r: 1 } });
});

// ============================================================================
// payments.js
// ============================================================================
test('listReceipts — empty when no cities', async () => {
  const r = await listReceipts(makeClient([]), { all: false, cityIds: [] });
  assert.deepEqual(r, []);
});

test('listReceipts — scoped + all branches', async () => {
  const c = makeClient([{ match: /FROM core\.receipt r/, rows: [{ id: 1 }] }]);
  assert.equal((await listReceipts(c, { all: true })).length, 1);
  assert.equal((await listReceipts(c, { all: false, cityIds: [1] })).length, 1);
});

test('listReceipts — clamp limit', async () => {
  const c = makeClient([{ match: /FROM core\.receipt r/, rows: [] }]);
  await listReceipts(c, { all: true }, { limit: 5000 });
});

test('listRefunds — scoped + empty', async () => {
  const r = await listRefunds(makeClient([]), { all: false, cityIds: [] });
  assert.deepEqual(r, []);
  const c = makeClient([{ match: /FROM core\.refund rf/, rows: [{ id: 1 }] }]);
  assert.equal((await listRefunds(c, { all: true })).length, 1);
  assert.equal((await listRefunds(c, { all: false, cityIds: [1] })).length, 1);
});

test('getStageDetail returns null when missing and row otherwise', async () => {
  const none = makeClient([{ match: /FROM core\.payment_stage ps/, rows: [] }]);
  assert.equal(await getStageDetail(none, 1), null);
  const c = makeClient([{ match: /FROM core\.payment_stage ps/, rows: [{ id: 1 }] }]);
  assert.equal((await getStageDetail(c, 1)).id, 1);
});

// ============================================================================
// workflows.js (approval_request)
// ============================================================================
test('submitApproval validates + inserts', async () => {
  const c = makeClient([{ match: /INSERT INTO core\.approval_request/, rows: [{ id: 1, status: 'pending', summary: 's', entity_type: 'v', entity_id: '1' }] }]);
  await assert.rejects(() => submitApproval(c, 1, {}), /required/);
  const r = await submitApproval(c, 1, { entity_type: 'v', entity_id: 1, summary: 's', payload: { x: 1 } });
  assert.equal(r.id, 1);
});

test('decideApproval rejects bad decisions + 409 when nothing to decide', async () => {
  await assert.rejects(() => decideApproval(makeClient([]), 1, 1, 'maybe'), /approved' or 'rejected/);
  const none = makeClient([
    { match: /SELECT status FROM core\.approval_request/, rows: [{ status: 'approved' }] },
    { match: /UPDATE core\.approval_request/, rows: [] }
  ]);
  await assert.rejects(() => decideApproval(none, 1, 1, 'approved'), /already decided/);
  const ok = makeClient([
    { match: /SELECT status FROM core\.approval_request/, rows: [{ status: 'pending' }] },
    { match: /UPDATE core\.approval_request/, rows: [{ id: 1, status: 'approved' }] }
  ]);
  const r = await decideApproval(ok, 1, 1, 'approved', 'notes');
  assert.equal(r.status, 'approved');
});

test('cancelApproval — 409 / happy path', async () => {
  const none = makeClient([
    { match: /SELECT status, requested_by FROM core\.approval_request/, rows: [{ status: 'pending', requested_by: 99 }] },
    { match: /UPDATE core\.approval_request/, rows: [] }
  ]);
  await assert.rejects(() => cancelApproval(none, 1, 1), /Only the requester/);
  const ok = makeClient([
    { match: /SELECT status, requested_by FROM core\.approval_request/, rows: [{ status: 'pending', requested_by: 1 }] },
    { match: /UPDATE core\.approval_request/, rows: [{ id: 1, status: 'canceled' }] }
  ]);
  const r = await cancelApproval(ok, 1, 1);
  assert.equal(r.status, 'canceled');
});

test('listApprovals — with and without status filter', async () => {
  const c = makeClient([{ match: /FROM core\.approval_request ar/, rows: [{ id: 1 }] }]);
  assert.equal((await listApprovals(c, {})).length, 1);
  assert.equal((await listApprovals(c, { status: 'pending', limit: 5000 })).length, 1);
});

test('getApproval — null when missing, row otherwise', async () => {
  const none = makeClient([{ match: /FROM core\.approval_request ar/, rows: [] }]);
  assert.equal(await getApproval(none, 1), null);
  const c = makeClient([{ match: /FROM core\.approval_request ar/, rows: [{ id: 1 }] }]);
  assert.equal((await getApproval(c, 1)).id, 1);
});

// ============================================================================
// ingestion.js
// ============================================================================
test('supportedResources returns the resource list', () => {
  const list = supportedResources();
  for (const k of ['candidates', 'items', 'venues']) assert.ok(list.includes(k));
});

test('runIngestion — unknown resource 400', async () => {
  const c = makeClient([]);
  await assert.rejects(() => runIngestion(c, 1, 'bogus', []), /Unknown resource/);
});

test('runIngestion — records must be an array', async () => {
  const c = makeClient([]);
  await assert.rejects(() => runIngestion(c, 1, 'items', null), /records must be an array/);
});

test('runIngestion — items inserted + updated + error branches', async () => {
  let call = 0;
  const c = makeClient([
    { match: /INSERT INTO core\.item/, rows: () => {
        call++;
        if (call === 1) return [{ inserted: true }];
        return [{ inserted: false }];
      }
    },
    { match: /INSERT INTO audit\.ingestion_run/, rows: [{ id: 1 }] }
  ]);
  const r = await runIngestion(c, 1, 'items', [
    { sku: 'A', name: 'n1' },
    { sku: 'B', name: 'n2', unit: 'kg', safety_threshold: 3 },
    { sku: '', name: 'bad' }, // validation error
    { sku: 'D', name: 'd', safety_threshold: -1 } // validation error
  ]);
  assert.equal(r.totals.inserted, 1);
  assert.equal(r.totals.updated,  1);
  assert.equal(r.totals.errors,    2);
});

test('runIngestion — venues path + unknown city_code', async () => {
  let resolved = false;
  const c = makeClient([
    { match: /FROM core\.city WHERE code/, rows: () => resolved ? [{ id: 1 }] : [] },
    { match: /INSERT INTO core\.venue/, rows: [{ inserted: true }] },
    { match: /INSERT INTO audit\.ingestion_run/, rows: [{ id: 1 }] }
  ]);
  // First record: city_code not found.
  const first = await runIngestion(c, 1, 'venues', [{ city_code: 'ZZZ', name: 'V' }]);
  assert.equal(first.totals.errors, 1);
  // Second run: city resolves.
  resolved = true;
  const second = await runIngestion(c, 1, 'venues', [{ city_code: 'NYC', name: 'V', latitude: 1, longitude: 2, address: 'a' }]);
  assert.equal(second.totals.inserted, 1);
});

test('runIngestion — venues validation errors', async () => {
  const c = makeClient([{ match: /INSERT INTO audit\.ingestion_run/, rows: [{ id: 1 }] }]);
  const r = await runIngestion(c, 1, 'venues', [{ city_code: 'NYC' }]); // missing name
  assert.equal(r.totals.errors, 1);
});

test('runIngestion — candidates insert + not-found + validation', async () => {
  let first = true;
  const c = makeClient([
    { match: /INSERT INTO core\.candidate/, rows: () => first ? (first = false, [{ id: 1 }]) : [] },
    { match: /INSERT INTO audit\.ingestion_run/, rows: [{ id: 1 }] }
  ]);
  const r = await runIngestion(c, 1, 'candidates', [
    { city_code: 'NYC', full_name: 'Ada' },
    { city_code: 'ZZZ', full_name: 'NoCity' },
    { city_code: '' } // validation
  ]);
  assert.equal(r.totals.inserted, 1);
  assert.equal(r.totals.errors, 2);
});

// ============================================================================
// ingestion_hooks.js
// ============================================================================
test('defaultHooks.userAgent / ipStrategy / captcha cover all branches', () => {
  assert.match(defaultHooks.userAgent({}), /RoadshowOps-Ingestion/);
  assert.equal(defaultHooks.userAgent({ user_agent: 'X' }), 'X');
  assert.equal(defaultHooks.ipStrategy({}), 'direct');
  assert.equal(defaultHooks.ipStrategy({ ip_hint: 'bind:eth0' }), 'bind:eth0');
  assert.equal(defaultHooks.captcha({}).strategy, 'none');
  assert.equal(defaultHooks.captcha({ captcha_strategy: 'prompt' }).message.length > 0, true);
  assert.equal(defaultHooks.captcha({ captcha_strategy: 'skip' }).message, null);
});

test('setHooks mutates the shared registry', () => {
  const orig = hooks.userAgent;
  setHooks({ userAgent: () => 'override' });
  assert.equal(hooks.userAgent({}), 'override');
  setHooks({ userAgent: orig }); // restore
});
