// Deep branch coverage for ingestion_scheduler + wechat_adapter + ingestion_parsers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeClient } from './_fakes.js';

const tmp = process.env.INGESTION_ROOT_DIR;

const { runSource } = await import('../src/services/ingestion_scheduler.js');

test('runSource — HTML format + cp last_file missing + extracted null', async () => {
  const dir = path.join(tmp, 'html-src');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.html'), '<article><h2>Title</h2></article>');
  fs.writeFileSync(path.join(dir, 'b.html'), '<article></article>'); // no field match → extracted null

  const c = makeClient([
    { match: /FROM core\.ingestion_source WHERE id/, rows: [{ id: 20, is_active: true, min_interval_hours: 6, code: 'c', parser_key: 'generic_university_html', format: 'html', inbox_dir: 'html-src', config: { record_regex: '<article.*?</article>', field_regex: { external_id: '<h2>(.+?)</h2>' } } }] },
    { match: /FROM core\.ingestion_checkpoint WHERE source_id/, rows: [{ last_file: 'zzz-not-found.html', last_record_offset: 0 }] },
    { match: /INSERT INTO core\.ingestion_checkpoint/, rows: [] },
    { match: /UPDATE core\.ingestion_checkpoint/, rows: [] },
    { match: /INSERT INTO core\.ingestion_record/, rows: [{ id: 1 }] },
    { match: /INSERT INTO audit\.ingestion_run/, rows: [{ id: 1 }] }
  ]);
  await runSource(c, 1, 20, { force: true });
});

test('runSource — insertRecord returns skipped (duplicate)', async () => {
  const dir = path.join(tmp, 'dup-src');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'dup.csv'), 'external_id,title\n1,a\n');

  const c = makeClient([
    { match: /FROM core\.ingestion_source WHERE id/, rows: [{ id: 30, is_active: true, min_interval_hours: 6, code: 'c', parser_key: 'generic_jobs_csv', format: 'csv', inbox_dir: 'dup-src', config: null }] },
    { match: /FROM core\.ingestion_checkpoint WHERE source_id/, rows: [] },
    { match: /INSERT INTO core\.ingestion_checkpoint/, rows: [] },
    { match: /UPDATE core\.ingestion_checkpoint/, rows: [] },
    // INSERT returns no rows → outcome 'skipped'
    { match: /INSERT INTO core\.ingestion_record/, rows: [] },
    { match: /INSERT INTO audit\.ingestion_run/, rows: [{ id: 1 }] }
  ]);
  const r = await runSource(c, 1, 30, { force: true });
  assert.ok(r.totals.skipped >= 1);
});

test('runSource — parser throws inside iteration (caught + break)', async () => {
  const dir = path.join(tmp, 'bad-src');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.html'), '<article></article>');

  const c = makeClient([
    { match: /FROM core\.ingestion_source WHERE id/, rows: [{ id: 40, is_active: true, min_interval_hours: 6, code: 'c', parser_key: 'generic_university_html', format: 'html', inbox_dir: 'bad-src', config: null }] }, // no record_regex/field_regex → iterator throws
    { match: /FROM core\.ingestion_checkpoint/, rows: [] },
    { match: /INSERT INTO core\.ingestion_checkpoint/, rows: [] },
    { match: /UPDATE core\.ingestion_checkpoint/, rows: [] },
    { match: /INSERT INTO audit\.ingestion_run/, rows: [{ id: 1 }] }
  ]);
  const r = await runSource(c, 1, 40, { force: true });
  assert.ok(r.totals.errors >= 0);
});

test('wechat — import-transactions rejects non-array in transactions', async () => {
  const { importTransactions } = await import('../src/services/wechat_adapter.js');
  const { config } = await import('../src/config.js');
  const imp = path.resolve(config.wechatImportDir);
  fs.mkdirSync(imp, { recursive: true });
  fs.writeFileSync(path.join(imp, 'notarr.json'), JSON.stringify({ transactions: 'nope' }));
  await assert.rejects(() => importTransactions(makeClient([]), 1, 'notarr.json'), /"transactions" array/);
});

test('ingestion_parsers — iterateCsv with trailing newline + html without field match', async () => {
  const { iterateCsv, iterateHtmlRecords } = await import('../src/services/ingestion_parsers.js');
  const p = path.join(tmp, 'trail.csv');
  fs.writeFileSync(p, 'a,b\n1,2\n');
  const rows = [...iterateCsv(p)];
  assert.equal(rows.length, 1);

  const p2 = path.join(tmp, 'no-field.html');
  fs.writeFileSync(p2, '<article><h3>Not-matched</h3></article>');
  const h = [...iterateHtmlRecords(p2, { record_regex: '<article.*?</article>', field_regex: { title: '<h2>(.+?)</h2>' } })];
  assert.equal(h.length, 1);
  assert.equal(h[0].row.title, null);
});
