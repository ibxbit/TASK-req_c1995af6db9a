// AES-256-GCM field-level encryption + masking helpers.
// Ciphertext payload format: 'v1:<b64 iv>:<b64 ct>:<b64 tag>'
//   iv  — 12 bytes (96-bit) random per encryption
//   tag — 16-byte GCM authentication tag
// Offline-safe: only uses node:crypto (no external services).

import crypto from 'node:crypto';
import { config } from '../config.js';

let cachedKey = null;

function getKey() {
  if (cachedKey) return cachedKey;
  if (!config.fieldEncryptionKey) {
    throw Object.assign(
      new Error('FIELD_ENCRYPTION_KEY is not configured'),
      { status: 500 }
    );
  }
  let buf;
  try {
    buf = Buffer.from(config.fieldEncryptionKey, 'base64');
  } catch {
    throw Object.assign(new Error('FIELD_ENCRYPTION_KEY is not valid base64'), { status: 500 });
  }
  if (buf.length !== 32) {
    throw Object.assign(
      new Error(`FIELD_ENCRYPTION_KEY must decode to 32 bytes (AES-256); got ${buf.length}`),
      { status: 500 }
    );
  }
  cachedKey = buf;
  return cachedKey;
}

export function encryptField(plaintext) {
  if (plaintext == null || plaintext === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${ct.toString('base64')}:${tag.toString('base64')}`;
}

export function decryptField(payload) {
  if (payload == null || payload === '') return null;
  const parts = String(payload).split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw Object.assign(new Error('Invalid encrypted payload'), { status: 500 });
  }
  const iv  = Buffer.from(parts[1], 'base64');
  const ct  = Buffer.from(parts[2], 'base64');
  const tag = Buffer.from(parts[3], 'base64');
  const dec = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  dec.setAuthTag(tag);
  return Buffer.concat([dec.update(ct), dec.final()]).toString('utf8');
}

/**
 * Mask a value leaving the last `show` characters visible.
 *   maskField('123456789')         -> '*****6789'
 *   maskField('123456789', {show:0}) -> '*********'
 *   maskField('ab')                -> '**'
 */
export function maskField(plaintext, { show = 4 } = {}) {
  if (plaintext == null) return null;
  const s = String(plaintext);
  const n = Math.max(0, Number.isFinite(show) ? Math.trunc(show) : 0);
  if (n === 0) return '*'.repeat(s.length);
  if (s.length <= n) return '*'.repeat(s.length);
  return '*'.repeat(s.length - n) + s.slice(-n);
}

/**
 * Convenience: given an encrypted payload, return its masked last-n characters
 * without exposing the plaintext to callers that only need the display hint.
 */
export function maskEncryptedField(encryptedPayload, opts) {
  if (!encryptedPayload) return null;
  return maskField(decryptField(encryptedPayload), opts);
}
