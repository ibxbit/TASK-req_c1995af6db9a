// Bulk data ingestion — JSON payloads only (offline, no file/network reads).
// Each resource has a validator + upsert function.
// Every run is recorded in audit.ingestion_run for traceability.

function err(status, message) { return Object.assign(new Error(message), { status }); }

const RESOURCES = {
  candidates: {
    validate(rec, i) {
      if (!rec.city_code || !rec.full_name) {
        throw new Error(`record[${i}]: city_code and full_name required`);
      }
      return {
        city_code: String(rec.city_code).trim(),
        full_name: String(rec.full_name).trim(),
        email: rec.email ?? null,
        status: rec.status ?? 'new'
      };
    },
    async upsert(client, userId, r) {
      const { rows } = await client.query(
        `WITH city AS (SELECT id FROM core.city WHERE code = $1)
         INSERT INTO core.candidate (city_id, full_name, email, status, created_by)
         SELECT city.id, $2, $3, $4, $5 FROM city
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [r.city_code, r.full_name, r.email, r.status, userId]
      );
      if (!rows[0]) throw new Error(`city_code '${r.city_code}' not found`);
      return 'inserted';
    }
  },

  items: {
    validate(rec, i) {
      if (!rec.sku || !rec.name) throw new Error(`record[${i}]: sku and name required`);
      if (rec.safety_threshold != null &&
          (!Number.isInteger(rec.safety_threshold) || rec.safety_threshold < 0)) {
        throw new Error(`record[${i}]: safety_threshold must be non-negative integer`);
      }
      return {
        sku: String(rec.sku).trim(),
        name: String(rec.name).trim(),
        unit: rec.unit ?? 'each',
        safety_threshold: rec.safety_threshold ?? 10
      };
    },
    async upsert(client, _userId, r) {
      const { rows } = await client.query(
        `INSERT INTO core.item (sku, name, unit, safety_threshold)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (sku) DO UPDATE
           SET name = EXCLUDED.name,
               unit = EXCLUDED.unit,
               safety_threshold = EXCLUDED.safety_threshold,
               updated_at = now()
         RETURNING (xmax = 0) AS inserted`,
        [r.sku, r.name, r.unit, r.safety_threshold]
      );
      return rows[0].inserted ? 'inserted' : 'updated';
    }
  },

  venues: {
    validate(rec, i) {
      if (!rec.city_code || !rec.name) {
        throw new Error(`record[${i}]: city_code and name required`);
      }
      return {
        city_code: String(rec.city_code).trim(),
        name: String(rec.name).trim(),
        address: rec.address ?? null,
        latitude:  rec.latitude  ?? null,
        longitude: rec.longitude ?? null
      };
    },
    async upsert(client, _userId, r) {
      const cityRes = await client.query(
        `SELECT id FROM core.city WHERE code = $1`, [r.city_code]
      );
      if (!cityRes.rows[0]) throw new Error(`city_code '${r.city_code}' not found`);
      const { rows } = await client.query(
        `INSERT INTO core.venue (city_id, name, address, latitude, longitude)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (city_id, name) DO UPDATE
           SET address   = EXCLUDED.address,
               latitude  = EXCLUDED.latitude,
               longitude = EXCLUDED.longitude
         RETURNING (xmax = 0) AS inserted`,
        [cityRes.rows[0].id, r.name, r.address, r.latitude, r.longitude]
      );
      return rows[0].inserted ? 'inserted' : 'updated';
    }
  }
};

export async function runIngestion(client, userId, resource, records) {
  const cfg = RESOURCES[resource];
  if (!cfg) throw err(400, `Unknown resource '${resource}'. Supported: ${Object.keys(RESOURCES).join(', ')}`);
  if (!Array.isArray(records)) throw err(400, 'records must be an array');

  let inserted = 0, updated = 0, skipped = 0;
  const errors = [];

  for (let i = 0; i < records.length; i++) {
    try {
      const normalised = cfg.validate(records[i], i);
      const result = await cfg.upsert(client, userId, normalised);
      if (result === 'inserted') inserted++;
      else if (result === 'updated') updated++;
      else skipped++;
    } catch (e) {
      errors.push({ index: i, message: e.message });
    }
  }

  // audit.ingestion_run is append-only: insert once at completion.
  const runIns = await client.query(
    `INSERT INTO audit.ingestion_run
       (resource, actor_user_id, record_count,
        inserted, updated, skipped, errors, finished_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now())
     RETURNING id`,
    [
      resource, userId, records.length,
      inserted, updated, skipped,
      errors.length ? JSON.stringify(errors) : null
    ]
  );

  return {
    run_id: runIns.rows[0].id,
    resource,
    totals: { records: records.length, inserted, updated, skipped, errors: errors.length },
    errors
  };
}

export function supportedResources() {
  return Object.keys(RESOURCES);
}
