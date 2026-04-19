// Unit tests — AES-256-GCM field encryption + masking.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Provided by the backend container via docker-compose env. Fall back to a
// deterministic 32-byte zero key so the test is self-sufficient if run directly.
if (!process.env.FIELD_ENCRYPTION_KEY) {
  process.env.FIELD_ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
}

const { encryptField, decryptField, maskField, maskEncryptedField } =
  await import('../src/auth/crypto.js');

test('encrypt/decrypt round-trip', () => {
  const original = 'tax-id-123-45-6789';
  const ct = encryptField(original);
  assert.match(ct, /^v1:/);
  assert.equal(decryptField(ct), original);
});

test('each encryption uses a fresh IV', () => {
  const a = encryptField('same-plaintext');
  const b = encryptField('same-plaintext');
  assert.notEqual(a, b, 'ciphertexts must differ due to random IV');
});

test('mask leaves last-4 visible', () => {
  assert.equal(maskField('123456789'), '*****6789');
});

test('mask with show=0 fully masks', () => {
  assert.equal(maskField('abc', { show: 0 }), '***');
});

test('mask handles short strings', () => {
  assert.equal(maskField('abc'), '***');
});

test('encrypt(null) returns null', () => {
  assert.equal(encryptField(null), null);
  assert.equal(encryptField(''), null);
});

test('tamper detection — modified auth tag fails', () => {
  const ct = encryptField('secret');
  const parts = ct.split(':');
  parts[3] = Buffer.alloc(16).toString('base64'); // replace tag with zeros
  assert.throws(() => decryptField(parts.join(':')));
});

test('maskEncryptedField surfaces last-4 without raw plaintext to caller', () => {
  const ct = encryptField('1234567890');
  assert.equal(maskEncryptedField(ct, { show: 4 }), '******7890');
});
