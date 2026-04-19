// Unit tests — password policy. Run inside backend container.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePasswordStrength } from '../src/auth/password.js';

test('rejects password shorter than 12 characters', () => {
  assert.throws(() => validatePasswordStrength('short'), /at least 12/);
});

test('rejects empty string', () => {
  assert.throws(() => validatePasswordStrength(''));
});

test('rejects non-string', () => {
  assert.throws(() => validatePasswordStrength(null));
  assert.throws(() => validatePasswordStrength(undefined));
  assert.throws(() => validatePasswordStrength(123456789012));
});

test('rejects password with no uppercase letter', () => {
  assert.throws(() => validatePasswordStrength('abcdef123456!'), /uppercase/);
});

test('rejects password with no digit', () => {
  assert.throws(() => validatePasswordStrength('CorrectHorse!@#$'), /digit/);
});

test('rejects password with no special character', () => {
  assert.throws(() => validatePasswordStrength('CorrectHorse123'), /special/);
});

test('accepts exactly 12 characters with complexity', () => {
  assert.doesNotThrow(() => validatePasswordStrength('Abcdef12345!'));
});

test('accepts a longer complex password', () => {
  assert.doesNotThrow(() => validatePasswordStrength('CorrectHorse2Battery!'));
});
