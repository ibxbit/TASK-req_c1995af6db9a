// Unit tests — services/ingestion_parsers.js and services/ingestion_scheduler.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeClient } from './_fakes.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rso-ingest-'));
process.env.INGESTION_ROOT_DIR = tmp;

const {
  sha256, fileHash, iterateCsv, iterateHtmlRecords, PARSERS, getParser
} = await import('../src/services/ingestion_parsers.js');
const {
  listDueSources, runSource, tickScheduler
} = await import('../src/services/ingestion_scheduler.js');

test('sha256 + fileHash', () => {
  const p = path.join(tmp, 'h.txt');
  fs.writeFileSync(p, 'hello');
  const a = sha256('hello');
  const b = fileHash(p);
  assert.equal(a, b);
});

test('iterateCsv — quoted fields, escapes, offsets', () => {
  const p = path.join(tmp, 'a.csv');
  fs.writeFileSync(p, 'external_id,title\n1,"hi ""there"""\n2,bye\n');
  const rows = [...iterateCsv(p, 0)];
  assert.equal(rows.length, 2);
  assert.equal(rows[0].row.title, 'hi "there"');

  const skipped = [...iterateCsv(p, 1)];
  assert.equal(skipped.length, 1);
});

test('iterateCsv — empty file safe', () => {
  const p = path.join(tmp, 'empty.csv');
  fs.writeFileSync(p, '');
  const rows = [...iterateCsv(p)];
  assert.equal(rows.length, 0);
});

test('iterateHtmlRecords requires config', () => {
  const p = path.join(tmp, 'h.html');
  fs.writeFileSync(p, '<article><h2>A</h2></article>');
  assert.throws(() => [...iterateHtmlRecords(p, {})], /record_regex/);
});

test('iterateHtmlRecords extracts fields', () => {
  const p = path.join(tmp, 'h2.html');
  fs.writeFileSync(p, '<article><h2>Title1</h2></article><article><h2>Title2</h2></article>');
  const rows = [...iterateHtmlRecords(p, {
    record_regex: '<article.*?</article>',
    field_regex: { title: '<h2>(.+?)</h2>' }
  })];
  assert.equal(rows.length, 2);
  assert.equal(rows[0].row.title, 'Title1');
});

test('PARSERS.generic_jobs_csv yields external_key or null', () => {
  const { extract } = PARSERS.generic_jobs_csv;
  assert.equal(extract({ title: 'x' }), null);
  assert.deepEqual(extract({ external_id: '1', title: 'x' }).external_key, '1');
  assert.deepEqual(extract({ job_id: '9' }).external_key, '9');
});

test('PARSERS.generic_university_html and company_html', () => {
  assert.equal(PARSERS.generic_university_html.extract({}), null);
  assert.equal(PARSERS.generic_university_html.extract({ url: 'u' }).external_key, 'u');
  assert.equal(PARSERS.generic_company_html.extract({}), null);
  assert.equal(PARSERS.generic_company_html.extract({ url: 'u' }).external_key, 'u');
});

test('getParser throws on unknown key', () => {
  assert.throws(() => getParser('bogus'), /Unknown parser_key/);
});

// ============================================================================
// scheduler — listDueSources / runSource / tickScheduler
// ============================================================================

test('listDueSources returns rows', async () => {
  const c = makeClient([{ match: /FROM core\.ingestion_source s/, rows: [{ id: 1 }] }]);
  const r = await listDueSources(c);
  assert.equal(r.length, 1);
});

test('runSource — 404 / inactive / rate-limited', async () => {
  const none = makeClient([{ match: /FROM core\.ingestion_source WHERE id/, rows: [] }]);
  await assert.rejects(() => runSource(none, 1, 1), /Source not found/);

  const inactive = makeClient([{ match: /FROM core\.ingestion_source WHERE id/, rows: [{ id: 1, is_active: false }] }]);
  await assert.rejects(() => runSource(inactive, 1, 1), /inactive/);

  const now = new Date('2026-01-01T00:00:00Z');
  const rateLimited = makeClient([
    { match: /FROM core\.ingestion_source WHERE id/, rows: [{ id: 1, is_active: true, min_interval_hours: 6, code: 'c', parser_key: 'generic_jobs_csv', format: 'csv', inbox_dir: 'sub' }] },
    { match: /FROM core\.ingestion_checkpoint WHERE source_id/, rows: [{ last_run_started_at: now }] }
  ]);
  await assert.rejects(() => runSource(rateLimited, 1, 1, { now }), /next run at/);
});

test('runSource — format/parser mismatch', async () => {
  // Create source whose format doesn't match parser.format
  fs.mkdirSync(path.join(tmp, 'src1'), { recursive: true });
  const c = makeClient([
    { match: /FROM core\.ingestion_source WHERE id/, rows: [{ id: 1, is_active: true, min_interval_hours: 6, code: 'c', parser_key: 'generic_jobs_csv', format: 'html', inbox_dir: 'src1' }] },
    { match: /FROM core\.ingestion_checkpoint WHERE source_id/, rows: [] },
    { match: /INSERT INTO core\.ingestion_checkpoint/, rows: [] },
    { match: /UPDATE core\.ingestion_checkpoint/, rows: [] },
    { match: /INSERT INTO audit\.ingestion_run/, rows: [{ id: 1 }] }
  ]);
  await assert.rejects(() => runSource(c, 1, 1, { force: true }), /does not match parser/);
});

test('runSource — processes a CSV file end-to-end', async () => {
  fs.mkdirSync(path.join(tmp, 'src2'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'src2', 'a.csv'), 'external_id,title\n1,hi\n2,bye\n');
  const c = makeClient([
    { match: /FROM core\.ingestion_source WHERE id/, rows: [{ id: 10, is_active: true, min_interval_hours: 6, code: 'c', parser_key: 'generic_jobs_csv', format: 'csv', inbox_dir: 'src2', config: null }] },
    { match: /FROM core\.ingestion_checkpoint WHERE source_id/, rows: [] },
    { match: /INSERT INTO core\.ingestion_checkpoint/, rows: [] },
    { match: /UPDATE core\.ingestion_checkpoint/, rows: [] },
    { match: /INSERT INTO core\.ingestion_record/, rows: [{ id: 1 }] },
    { match: /INSERT INTO audit\.ingestion_run/, rows: [{ id: 1 }] }
  ]);
  const r = await runSource(c, 1, 10, { force: true });
  assert.equal(r.totals.inserted + r.totals.skipped >= 2, true);
});

test('runSource — missing inbox logs error', async () => {
  const c = makeClient([
    { match: /FROM core\.ingestion_source WHERE id/, rows: [{ id: 10, is_active: true, min_interval_hours: 6, code: 'c', parser_key: 'generic_jobs_csv', format: 'csv', inbox_dir: 'does-not-exist', config: null }] },
    { match: /FROM core\.ingestion_checkpoint WHERE source_id/, rows: [] },
    { match: /INSERT INTO core\.ingestion_checkpoint/, rows: [] },
    { match: /UPDATE core\.ingestion_checkpoint/, rows: [] },
    { match: /INSERT INTO audit\.ingestion_run/, rows: [{ id: 1 }] }
  ]);
  const r = await runSource(c, 1, 10, { force: true });
  assert.equal(r.totals.inserted, 0);
});

test('runSource — resumes from last_file offset', async () => {
  fs.mkdirSync(path.join(tmp, 'src3'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'src3', 'a.csv'), 'external_id,title\n1,hi\n2,bye\n');
  const c = makeClient([
    { match: /FROM core\.ingestion_source WHERE id/, rows: [{ id: 10, is_active: true, min_interval_hours: 6, code: 'c', parser_key: 'generic_jobs_csv', format: 'csv', inbox_dir: 'src3', config: null }] },
    { match: /FROM core\.ingestion_checkpoint WHERE source_id/, rows: [{ last_file: 'a.csv', last_record_offset: 1 }] },
    { match: /INSERT INTO core\.ingestion_checkpoint/, rows: [] },
    { match: /UPDATE core\.ingestion_checkpoint/, rows: [] },
    { match: /INSERT INTO core\.ingestion_record/, rows: [{ id: 1 }] },
    { match: /INSERT INTO audit\.ingestion_run/, rows: [{ id: 1 }] }
  ]);
  const r = await runSource(c, 1, 10, { force: true });
  assert.ok(r);
});

test('runSource — escape of ingestion root is rejected', async () => {
  const c = makeClient([
    { match: /FROM core\.ingestion_source WHERE id/, rows: [{ id: 11, is_active: true, min_interval_hours: 6, code: 'c', parser_key: 'generic_jobs_csv', format: 'csv', inbox_dir: '../escape', config: null }] },
    { match: /FROM core\.ingestion_checkpoint WHERE source_id/, rows: [] },
    { match: /INSERT INTO core\.ingestion_checkpoint/, rows: [] },
    { match: /UPDATE core\.ingestion_checkpoint/, rows: [] },
    { match: /INSERT INTO audit\.ingestion_run/, rows: [{ id: 1 }] }
  ]);
  await assert.rejects(() => runSource(c, 1, 11, { force: true }), /escapes ingestion root/);
});

test('tickScheduler runs due sources, catches errors', async () => {
  const c = makeClient([
    { match: /FROM core\.ingestion_source s/, rows: [{ id: 1 }] },
    { match: /FROM core\.ingestion_source WHERE id/, rows: [] } // 404 for each
  ]);
  const r = await tickScheduler(c, 1);
  assert.equal(r.checked, 1);
  assert.ok(r.runs[0].error);
});
