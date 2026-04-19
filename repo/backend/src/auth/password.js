import bcrypt from 'bcryptjs';
import { config } from '../config.js';

export const hashPassword = (plain) => bcrypt.hash(plain, config.bcryptCost);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

/**
 * Enforce password policy. Throws a 400-status error on violation.
 * Policy: minimum length (default 12), plus uppercase, digit, and special character.
 */
export function validatePasswordStrength(password) {
  if (typeof password !== 'string' || password.length < config.passwordMinLength) {
    throw Object.assign(
      new Error(`Password must be at least ${config.passwordMinLength} characters`),
      { status: 400 }
    );
  }
  if (!/[A-Z]/.test(password)) {
    throw Object.assign(
      new Error('Password must contain at least one uppercase letter'),
      { status: 400 }
    );
  }
  if (!/[0-9]/.test(password)) {
    throw Object.assign(
      new Error('Password must contain at least one digit'),
      { status: 400 }
    );
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    throw Object.assign(
      new Error('Password must contain at least one special character'),
      { status: 400 }
    );
  }
}
