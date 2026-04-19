import 'dotenv/config';

const required = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
};

export const config = {
  port: Number(process.env.PORT || 4000),
  host: process.env.HOST || '0.0.0.0',
  logLevel: process.env.LOG_LEVEL || 'info',
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(','),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  bcryptCost: Number(process.env.BCRYPT_COST || 10),
  wechatImportDir: process.env.WECHAT_IMPORT_DIR || './wechat_imports',
  wechatSharedSecret: process.env.WECHAT_SHARED_SECRET || null,
  paymentRetryMax: Number(process.env.PAYMENT_RETRY_MAX || 3),
  paymentRetryIntervalMinutes: Number(process.env.PAYMENT_RETRY_INTERVAL_MINUTES || 5),
  ingestionRootDir: process.env.INGESTION_ROOT_DIR || './ingestion_inbox',
  ingestionSchedulerIntervalMinutes: Number(process.env.INGESTION_SCHEDULER_INTERVAL_MINUTES || 5),
  passwordMinLength: Number(process.env.PASSWORD_MIN_LENGTH || 12),
  lockoutThreshold: Number(process.env.LOCKOUT_THRESHOLD || 5),
  lockoutMinutes:   Number(process.env.LOCKOUT_MINUTES   || 15),
  fieldEncryptionKey: process.env.FIELD_ENCRYPTION_KEY || null,
  auditRetentionYears: Number(process.env.AUDIT_RETENTION_YEARS || 7)
};
