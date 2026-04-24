// Scheduler + runner for multi-source ingestion.
//
// Responsibilities:
//   * Respect per-source `min_interval_hours` (≥ 6).
//   * Walk files in `inbox_dir` in stable order, resuming from the last
//     checkpoint (last_file + last_record_offset).
//   * Dedupe records by (source_id, external_key); log every run in the
//     append-only audit.ingestion_run table with source_id linked.
//   * Expose hooks() for UA/IP/CAPTCHA extensibility (no-op offline).

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { getParser, iterateCsv, iterateHtmlRecords, fileHash, sha256 } from './ingestion_parsers.js';
import { hooks } from './ingestion_hooks.js';

function err(status, message) { return Object.assign(new Error(message), { status }); }

const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

function resolveInbox(inboxDir) {
  const root = path.resolve(config.ingestionRootDir);
  const full = path.resolve(root, inboxDir);
  if (!full.startsWith(root + path.sep) && full !== root) {
    throw err(400, `inbox_dir '${inboxDir}' escapes ingestion root`);
  }
  return full;
}

export async function listDueSources(client, { now = new Date() } = {}) {
  const { rows } = await client.query(
    `SELECT s.id, s.code, s.type, s.format, s.inbox_dir, s.parser_key,
            s.min_interval_hours, s.is_active, s.config,
            cp.last_run_started_at, cp.last_file, cp.last_record_offset, cp.last_file_hash
       FROM core.ingestion_source s
  LEFT JOIN core.ingestion_checkpoint cp ON cp.source_id = s.id
      WHERE s.is_active = TRUE
        AND (
              cp.last_run_started_at IS NULL
           OR cp.last_run_started_at <= $1::timestamptz - make_interval(hours => s.min_interval_hours)
        )
      ORDER BY COALESCE(cp.last_run_started_at, 'epoch'::timestamptz)`,
    [now]
  );
  return rows;
}

async function lockSource(client, sourceId) {
  const { rows } = await client.query(
    `SELECT * FROM core.ingestion_source WHERE id = $1 FOR UPDATE`,
    [sourceId]
  );
  return rows[0] || null;
}

async function loadCheckpoint(client, sourceId) {
  const { rows } = await client.query(
    `SELECT * FROM core.ingestion_checkpoint WHERE source_id = $1`,
    [sourceId]
  );
  return rows[0] || null;
}

async function beginCheckpoint(client, sourceId, now) {
  await client.query(
    `INSERT INTO core.ingestion_checkpoint
       (source_id, last_run_started_at, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (source_id) DO UPDATE
       SET last_run_started_at = EXCLUDED.last_run_started_at,
           updated_at = now()`,
    [sourceId, now]
  );
}

async function finalizeCheckpoint(client, sourceId, { lastFile, lastOffset, lastHash, cursor }) {
  await client.query(
    `UPDATE core.ingestion_checkpoint
        SET last_run_finished_at = now(),
            last_file = $2,
            last_record_offset = $3,
            last_file_hash = $4,
            cursor = $5,
            updated_at = now()
      WHERE source_id = $1`,
    [sourceId, lastFile, lastOffset, lastHash, cursor ? JSON.stringify(cursor) : null]
  );
}

async function insertRecord(client, source, extracted) {
  const fingerprint = sha256(JSON.stringify(extracted.data));
  const ins = await client.query(
    `INSERT INTO core.ingestion_record
       (source_id, external_key, fingerprint, data)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (source_id, external_key) DO NOTHING
     RETURNING id`,
    [source.id, extracted.external_key, fingerprint, JSON.stringify(extracted.data)]
  );
  return ins.rows[0] ? 'inserted' : 'skipped';
}

/**
 * Run a single source (idempotent given stable input files). Safe to call
 * from the scheduler tick or from a manual API trigger.
 *   Enforces min_interval_hours unless `force = true`.
 */
export async function runSource(client, userId, sourceId, { now = new Date(), force = false } = {}) {
  const source = await lockSource(client, sourceId);
  if (!source) throw err(404, 'Source not found');
  if (!source.is_active) throw err(409, 'Source is inactive');

  const cp = await loadCheckpoint(client, sourceId);
  if (!force && cp?.last_run_started_at) {
    const dueAt = new Date(new Date(cp.last_run_started_at).getTime() + source.min_interval_hours * 3600_000);
    if (now < dueAt) {
      throw err(409, `Source ${source.code} next run at ${dueAt.toISOString()} (min_interval_hours=${source.min_interval_hours})`);
    }
  }

  // Hook read (metadata only in offline mode, but invoked so operator logs can capture it)
  const ua = hooks.userAgent(source);
  const ipPlan = hooks.ipStrategy(source);
  const captchaPlan = hooks.captcha(source);

  await beginCheckpoint(client, sourceId, now);

  const parser = getParser(source.parser_key);
  if (parser.format !== source.format) {
    throw err(400, `Source format '${source.format}' does not match parser '${source.parser_key}' (${parser.format})`);
  }

  const inboxPath = resolveInbox(source.inbox_dir);
  const startedAt = now;
  let inserted = 0, skipped = 0;
  const errors = [];
  let lastFile = cp?.last_file ?? null;
  let lastOffset = cp?.last_record_offset ?? 0;
  let lastHash = cp?.last_file_hash ?? null;

  if (!fs.existsSync(inboxPath) || !fs.statSync(inboxPath).isDirectory()) {
    errors.push({ message: `Inbox directory missing: ${source.inbox_dir}` });
  } else {
    const files = fs.readdirSync(inboxPath)
      .filter((f) => SAFE_NAME.test(f) && f.toLowerCase().endsWith(`.${source.format}`))
      .sort();

    let startFrom = 0;
    if (cp?.last_file) {
      const idx = files.indexOf(cp.last_file);
      if (idx >= 0) {
        // If we have an offset, resume within the same file;
        // otherwise the file is fully processed and we move on.
        startFrom = (cp.last_record_offset > 0) ? idx : idx + 1;
      }
    }

    for (let i = startFrom; i < files.length; i++) {
      const filename = files[i];
      const filePath = path.join(inboxPath, filename);
      const hash = fileHash(filePath);
      const resumeOffset = (filename === cp?.last_file) ? cp.last_record_offset : 0;

      try {
        const iterator = source.format === 'csv'
          ? iterateCsv(filePath, resumeOffset)
          : iterateHtmlRecords(filePath, source.config || {});

        for (const { offset, row } of iterator) {
          if (source.format === 'html' && offset <= resumeOffset) continue;
          const extracted = parser.extract(row, source.config);
          if (!extracted) { skipped++; lastOffset = offset; continue; }
          const outcome = await insertRecord(client, source, extracted);
          if (outcome === 'inserted') inserted++; else skipped++;
          lastOffset = offset;
        }

        lastFile = filename;
        lastHash = hash;
        lastOffset = 0; // file complete
      } catch (e) {
        errors.push({ file: filename, message: e.message });
        // Keep current lastFile / lastOffset so next run resumes at this point.
        break;
      }
    }
  }

  await finalizeCheckpoint(client, sourceId, {
    lastFile, lastOffset, lastHash,
    cursor: { ua, ipPlan, captchaPlan }
  });

  const runIns = await client.query(
    `INSERT INTO audit.ingestion_run
       (resource, source_id, actor_user_id, record_count,
        inserted, updated, skipped, errors, started_at, finished_at)
     VALUES ($1,$2,$3,$4,$5,0,$6,$7,$8, now())
     RETURNING id`,
    [
      source.code, source.id, userId ?? null,
      inserted + skipped, inserted, skipped,
      errors.length ? JSON.stringify(errors) : null,
      startedAt
    ]
  );

  return {
    source_id: sourceId,
    source_code: source.code,
    run_id: runIns.rows[0].id,
    started_at: startedAt,
    totals: { inserted, skipped, errors: errors.length },
    checkpoint: { last_file: lastFile, last_record_offset: lastOffset },
    hooks: { user_agent: ua, ip_strategy: ipPlan, captcha: captchaPlan }
  };
}

/**
 * Scheduler tick: run every due source. Called from server.js on an interval.
 */
export async function tickScheduler(client, userId) {
  const due = await listDueSources(client, { now: new Date() });
  const runs = [];
  for (const src of due) {
    try {
      runs.push(await runSource(client, userId, src.id));
    } catch (e) {
      runs.push({ source_id: src.id, error: e.message });
    }
  }
  return { checked: due.length, runs };
}
