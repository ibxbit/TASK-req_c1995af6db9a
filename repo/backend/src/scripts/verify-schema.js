// Bootstrap-integrity verification.
//
// Fails with exit 1 if any runtime-required DB object is missing.
// Every object listed here is touched by live application code; missing any
// of them means the documented bootstrap path is incomplete.

import { pool } from '../db.js';

const requiredTables = [
  ['core', 'app_user'],
  ['core', 'role'],
  ['core', 'permission'],
  ['core', 'role_permission'],
  ['core', 'user_role'],
  ['core', 'user_city'],
  ['core', 'city'],
  ['core', 'candidate'],
  ['core', 'finance_transaction'],
  ['core', 'venue'],
  ['core', 'drive_time'],
  ['core', 'itinerary'],
  ['core', 'itinerary_event'],
  ['core', 'itinerary_version'],
  ['core', 'itinerary_template'],
  ['core', 'itinerary_template_event'],
  ['core', 'event'],
  ['core', 'event_order'],
  ['core', 'payment_stage'],
  ['core', 'invoice'],
  ['core', 'receipt'],
  ['core', 'refund'],
  ['core', 'warehouse'],
  ['core', 'warehouse_location'],
  ['core', 'item'],
  ['core', 'stock'],
  ['core', 'stock_movement'],
  ['core', 'stock_reservation'],
  ['core', 'cycle_count'],
  ['core', 'event_order_line'],
  ['core', 'approval_request'],
  ['core', 'payment_intake'],
  ['core', 'workflow_definition'],
  ['core', 'workflow_step'],
  ['core', 'workflow_instance'],
  ['core', 'workflow_task'],
  ['core', 'vendor'],
  ['core', 'ingestion_source'],
  ['core', 'ingestion_checkpoint'],
  ['core', 'ingestion_record'],
  ['audit', 'permission_event'],
  ['audit', 'stock_ledger'],
  ['audit', 'ingestion_run'],
  ['audit', 'payment_attempt'],
  ['audit', 'financial_ledger'],
];

const requiredViews = [
  ['core', 'v_user_permission'],
  ['core', 'v_item_stock_summary'],
  ['core', 'v_stock_position'],
  ['core', 'v_low_stock_item'],
  ['audit', 'v_audit_log'],
];

const requiredColumns = [
  ['core', 'app_user', 'failed_login_count'],
  ['core', 'app_user', 'locked_until'],
  ['core', 'vendor', 'tax_id_encrypted'],
  ['core', 'vendor', 'bank_routing_encrypted'],
  ['core', 'vendor', 'bank_account_encrypted'],
  ['core', 'vendor', 'bank_account_last4'],
  ['audit', 'permission_event', 'workstation'],
  ['audit', 'permission_event', 'entity_type'],
  ['audit', 'permission_event', 'entity_id'],
  ['audit', 'ingestion_run', 'source_id'],
];

const requiredAuditSources = [
  'permission_event',
  'stock_ledger',
  'payment_attempt',
  'ingestion_run',
  'financial_ledger',
];

async function checkTables() {
  const missing = [];
  for (const [schema, name] of requiredTables) {
    const { rows } = await pool.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = $1 AND table_name = $2`,
      [schema, name]
    );
    if (!rows.length) missing.push(`${schema}.${name}`);
  }
  return missing;
}

async function checkViews() {
  const missing = [];
  for (const [schema, name] of requiredViews) {
    const { rows } = await pool.query(
      `SELECT 1 FROM information_schema.views
        WHERE table_schema = $1 AND table_name = $2`,
      [schema, name]
    );
    if (!rows.length) missing.push(`${schema}.${name}`);
  }
  return missing;
}

async function checkColumns() {
  const missing = [];
  for (const [schema, table, column] of requiredColumns) {
    const { rows } = await pool.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
      [schema, table, column]
    );
    if (!rows.length) missing.push(`${schema}.${table}.${column}`);
  }
  return missing;
}

async function checkAuditView() {
  // audit.v_audit_log may have zero rows for non-permission_event sources on
  // a fresh DB, so we inspect the view's definition text — every expected
  // source must appear as a string literal in one of its UNION branches.
  const { rows } = await pool.query(
    `SELECT pg_get_viewdef('audit.v_audit_log'::regclass, true) AS def`
  ).catch(() => ({ rows: [] }));
  const def = rows[0]?.def || '';
  return requiredAuditSources.filter((s) => !def.includes(`'${s}'`));
}

export async function verifySchema() {
  const [missingTables, missingViews, missingColumns, missingSources] =
    await Promise.all([checkTables(), checkViews(), checkColumns(), checkAuditView()]);
  return { missingTables, missingViews, missingColumns, missingSources };
}

async function main() {
  const result = await verifySchema();
  const { missingTables, missingViews, missingColumns, missingSources } = result;
  const anyMissing =
    missingTables.length || missingViews.length ||
    missingColumns.length || missingSources.length;

  if (anyMissing) {
    console.error('[verify-schema] missing DB objects:');
    if (missingTables.length)  console.error('  tables:  ', missingTables.join(', '));
    if (missingViews.length)   console.error('  views:   ', missingViews.join(', '));
    if (missingColumns.length) console.error('  columns: ', missingColumns.join(', '));
    if (missingSources.length) console.error('  audit sources: ', missingSources.join(', '));
    process.exit(1);
  }
  console.log('[verify-schema] all required DB objects present');
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('verify-schema.js')) {
  try {
    await main();
  } finally {
    await pool.end();
  }
}
