// Preloaded by `node --import ./unit_tests/_setup.js --test` when running
// unit tests standalone (e.g. under c8 coverage) so that `config.js`
// doesn't throw on its required() envs. Values are placeholder strings that
// never touch a real database — all DB calls in unit tests use fake clients.
process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5432/test';
process.env.JWT_SECRET   ??= 'unit-test-jwt-secret-not-used-for-anything-real';
process.env.FIELD_ENCRYPTION_KEY ??= 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
process.env.WECHAT_SHARED_SECRET ??= 'unit-test-wechat-secret';
process.env.INGESTION_ROOT_DIR   ??= './.test-ingestion';
process.env.WECHAT_IMPORT_DIR    ??= './.test-wechat';
