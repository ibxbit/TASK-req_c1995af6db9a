// Parser framework for offline ingestion.
// Built-in parsers: CSV (generic) and HTML (config-driven regex blocks).
// Extend by adding entries to PARSERS.

import fs from 'node:fs';
import crypto from 'node:crypto';

export function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function fileHash(filePath) {
  return sha256(fs.readFileSync(filePath));
}

// --------------------------------------------------------------------------
// CSV (RFC 4180 subset: quoted fields, escaped quotes, comma separator)
// --------------------------------------------------------------------------
function parseCsvLine(line) {
  const out = [];
  let cur = '', inQ = false, i = 0;
  while (i < line.length) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 2; continue; }
      if (c === '"') { inQ = false; i++; continue; }
      cur += c; i++;
    } else {
      if (c === '"') { inQ = true; i++; continue; }
      if (c === ',') { out.push(cur); cur = ''; i++; continue; }
      cur += c; i++;
    }
  }
  out.push(cur);
  return out;
}

/**
 * Yield one parsed CSV row at a time, starting AFTER `startOffset` rows.
 * Offset is 1-based data row index (header row is row 0).
 */
export function* iterateCsv(filePath, startOffset = 0) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  if (!lines.length) return;
  const header = parseCsvLine(lines[0]);
  let dataIdx = 0;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '' && i === lines.length - 1) break; // trailing newline
    dataIdx++;
    if (dataIdx <= startOffset) continue;
    const values = parseCsvLine(lines[i]);
    const row = {};
    header.forEach((h, j) => { row[h] = values[j] ?? null; });
    yield { offset: dataIdx, row };
  }
}

// --------------------------------------------------------------------------
// HTML: block-per-record via regex configured on the source.
//   config = { record_regex: "<article.*?</article>",
//              field_regex:  { title: "<h2>(.+?)</h2>", url: "href=\"(.+?)\"" } }
// --------------------------------------------------------------------------
export function* iterateHtmlRecords(filePath, config) {
  if (!config?.record_regex || !config?.field_regex) {
    throw new Error('HTML source requires config.record_regex and config.field_regex');
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const rx = new RegExp(config.record_regex, 'gms');
  let m; let offset = 0;
  while ((m = rx.exec(content)) !== null) {
    offset++;
    const block = m[0];
    const fields = {};
    for (const [key, pattern] of Object.entries(config.field_regex)) {
      const fm = new RegExp(pattern, 'ms').exec(block);
      fields[key] = fm?.[1]?.trim() ?? null;
    }
    yield { offset, row: fields };
  }
}

// --------------------------------------------------------------------------
// Parser registry: maps parser_key (stored on ingestion_source) to an
// extract() that turns a raw row into a staged record.
// --------------------------------------------------------------------------
export const PARSERS = {
  // Generic job-board CSV: expects external_id,title,company,location,posted_at,description
  generic_jobs_csv: {
    format: 'csv',
    extract(row) {
      const external_key = row.external_id || row.id || row.job_id;
      return external_key ? { external_key: String(external_key), data: row } : null;
    }
  },

  // Generic university-portal HTML: config supplies record_regex + field_regex.
  generic_university_html: {
    format: 'html',
    extract(row) {
      const external_key = row.external_id || row.posting_id || row.url;
      return external_key ? { external_key: String(external_key), data: row } : null;
    }
  },

  // Generic company-site HTML.
  generic_company_html: {
    format: 'html',
    extract(row) {
      const external_key = row.url || row.posting_id;
      return external_key ? { external_key: String(external_key), data: row } : null;
    }
  }
};

export function getParser(parserKey) {
  const p = PARSERS[parserKey];
  if (!p) throw new Error(`Unknown parser_key '${parserKey}'. Registered: ${Object.keys(PARSERS).join(', ')}`);
  return p;
}
