// WeChat Pay offline adapter.
// No network calls — operators drop JSON files in WECHAT_IMPORT_DIR and call
// the import endpoints. Each entry carries an HMAC-SHA256 signature computed
// by the originating system using the shared secret; the adapter verifies
// every entry before accepting it.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';

function err(status, message) {
  return Object.assign(new Error(message), { status });
}

// Only allow simple filenames — blocks path traversal (../, absolute paths).
const SAFE_FILENAME = /^[A-Za-z0-9._-]+$/;

function resolveImportPath(filename) {
  if (!filename || !SAFE_FILENAME.test(filename)) {
    throw err(400, 'filename must match /^[A-Za-z0-9._-]+$/');
  }
  const baseDir = path.resolve(config.wechatImportDir);
  const full = path.resolve(baseDir, filename);
  if (!full.startsWith(baseDir + path.sep) && full !== baseDir) {
    throw err(400, 'filename escapes import directory');
  }
  return full;
}

function readJsonFile(filename) {
  const full = resolveImportPath(filename);
  if (!fs.existsSync(full)) throw err(404, `File not found: ${filename}`);
  const raw = fs.readFileSync(full, 'utf8');
  try { return JSON.parse(raw); }
  catch (e) { throw err(400, `Invalid JSON in ${filename}: ${e.message}`); }
}

// Canonical string for signing: field=value pairs joined by '|' in a fixed order.
function canonicalize(fields, obj) {
  return fields.map((f) => `${f}=${obj[f] ?? ''}`).join('|');
}

function hmacHex(secret, message) {
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

export function verifySignature(secret, fields, record) {
  if (!record.signature) return false;
  const expected = hmacHex(secret, canonicalize(fields, record));
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(String(record.signature), 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

const TX_FIELDS = ['external_id', 'amount_cents', 'currency', 'order_id', 'paid_at'];
const CB_FIELDS = ['external_id', 'status', 'paid_at'];

function requireSecret() {
  if (!config.wechatSharedSecret) {
    throw err(500, 'WECHAT_SHARED_SECRET is not configured — cannot verify signatures');
  }
  return config.wechatSharedSecret;
}

/**
 * Import a transactions file. Each verified entry becomes a payment_intake row.
 * Duplicates (same external_id) are skipped due to the UNIQUE constraint.
 */
export async function importTransactions(client, userId, filename) {
  const secret = requireSecret();
  const doc = readJsonFile(filename);
  if (!Array.isArray(doc?.transactions)) {
    throw err(400, 'File must contain a "transactions" array');
  }

  const imported = [];
  const skipped = [];
  const rejected = [];

  for (let i = 0; i < doc.transactions.length; i++) {
    const tx = doc.transactions[i];
    if (!tx.external_id || !tx.amount_cents || !tx.order_id) {
      rejected.push({ index: i, external_id: tx.external_id ?? null, reason: 'missing required fields' });
      continue;
    }
    const ok = verifySignature(secret, TX_FIELDS, tx);
    if (!ok) {
      rejected.push({ index: i, external_id: tx.external_id, reason: 'invalid signature' });
      continue;
    }

    const ins = await client.query(
      `INSERT INTO core.payment_intake
         (method, external_id, order_id, amount_cents, currency,
          raw_payload, signature, signature_verified, created_by)
       VALUES ('wechat',$1,$2,$3,COALESCE($4,'USD'),$5,$6,TRUE,$7)
       ON CONFLICT (method, external_id) DO NOTHING
       RETURNING id`,
      [
        tx.external_id, tx.order_id, tx.amount_cents, tx.currency ?? null,
        JSON.stringify(tx), tx.signature, userId
      ]
    );
    if (ins.rows[0]) imported.push({ intake_id: ins.rows[0].id, external_id: tx.external_id });
    else skipped.push({ external_id: tx.external_id, reason: 'already imported' });
  }

  return {
    filename,
    totals: {
      received:  doc.transactions.length,
      imported:  imported.length,
      skipped:   skipped.length,
      rejected:  rejected.length
    },
    imported, skipped, rejected
  };
}

/**
 * Import a callback file. Callbacks annotate existing intakes with a confirmed
 * success/failure status. Only signed callbacks are honoured.
 */
export async function importCallbacks(client, _userId, filename) {
  const secret = requireSecret();
  const doc = readJsonFile(filename);
  if (!Array.isArray(doc?.callbacks)) {
    throw err(400, 'File must contain a "callbacks" array');
  }

  const applied = [];
  const rejected = [];
  const unmatched = [];

  for (let i = 0; i < doc.callbacks.length; i++) {
    const cb = doc.callbacks[i];
    if (!cb.external_id || !cb.status) {
      rejected.push({ index: i, reason: 'missing required fields' });
      continue;
    }
    const ok = verifySignature(secret, CB_FIELDS, cb);
    if (!ok) {
      rejected.push({ index: i, external_id: cb.external_id, reason: 'invalid signature' });
      continue;
    }

    const { rows } = await client.query(
      `SELECT id, status FROM core.payment_intake
        WHERE method = 'wechat' AND external_id = $1
        FOR UPDATE`,
      [cb.external_id]
    );
    const intake = rows[0];
    if (!intake) { unmatched.push({ external_id: cb.external_id }); continue; }

    if (cb.status === 'SUCCESS') {
      // Signal the processor to apply this intake by ensuring it's in the queue.
      if (intake.status === 'received' || intake.status === 'failed') {
        await client.query(
          `UPDATE core.payment_intake
              SET next_attempt_at = now(), updated_at = now()
            WHERE id = $1`,
          [intake.id]
        );
      }
      applied.push({ intake_id: intake.id, external_id: cb.external_id, signalled: true });
    } else {
      await client.query(
        `UPDATE core.payment_intake
            SET status = 'rejected',
                last_error = COALESCE(last_error, '') ||
                             '; callback=' || $2::text,
                updated_at = now()
          WHERE id = $1`,
        [intake.id, cb.status]
      );
      applied.push({ intake_id: intake.id, external_id: cb.external_id, signalled: false });
    }
  }

  return {
    filename,
    totals: {
      received:  doc.callbacks.length,
      applied:   applied.length,
      unmatched: unmatched.length,
      rejected:  rejected.length
    },
    applied, unmatched, rejected
  };
}
