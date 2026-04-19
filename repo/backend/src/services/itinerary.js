import { resolveDriveTime } from './drive_time.js';

export const MIN_BUFFER_MINUTES = 15;

/**
 * Detects:
 *  - overlap: any two events whose time ranges intersect
 *  - buffer:  consecutive events (sorted by start_at) with gap < 15 + drive-time
 *  - drive_time_missing: consecutive events whose venues lack both coords and manual entry
 */
export async function computeIssues(client, events) {
  const issues = [];
  const sorted = [...events].sort(
    (a, b) => new Date(a.start_at) - new Date(b.start_at)
  );

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i], b = sorted[j];
      if (
        new Date(a.start_at) < new Date(b.end_at) &&
        new Date(b.start_at) < new Date(a.end_at)
      ) {
        issues.push({
          type: 'overlap',
          eventIds: [a.id, b.id],
          message: `Events "${a.title}" and "${b.title}" overlap`
        });
      }
    }
  }

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1], next = sorted[i];
    const drive = await resolveDriveTime(client, prev.venue_id, next.venue_id);

    if (drive.source === 'manual_required') {
      issues.push({
        type: 'drive_time_missing',
        fromEventId: prev.id, toEventId: next.id,
        fromVenueId: prev.venue_id, toVenueId: next.venue_id,
        message:
          'Drive time between these venues is unknown — coordinates missing. ' +
          'Submit a manual drive time via POST /venues/drive-time.'
      });
      continue;
    }

    const gapMin = Math.floor(
      (new Date(next.start_at) - new Date(prev.end_at)) / 60000
    );
    const required = MIN_BUFFER_MINUTES + (drive.minutes || 0);
    if (gapMin < required) {
      issues.push({
        type: 'buffer',
        fromEventId: prev.id, toEventId: next.id,
        actualMinutes: gapMin,
        requiredMinutes: required,
        bufferMinutes: MIN_BUFFER_MINUTES,
        driveMinutes: drive.minutes || 0,
        driveSource: drive.source,
        driveDistanceKm: drive.distance_km ?? null,
        message:
          `Gap between "${prev.title}" and "${next.title}" is ${gapMin} min; ` +
          `needs ≥ ${required} (${MIN_BUFFER_MINUTES} buffer + ${drive.minutes || 0} drive)`
      });
    }
  }

  return { valid: issues.length === 0, issues };
}

export async function loadItineraryAggregate(client, itineraryId) {
  const iRes = await client.query(
    `SELECT id, city_id, owner_user_id, name, itinerary_date, current_version,
            created_at, updated_at
       FROM core.itinerary WHERE id = $1`,
    [itineraryId]
  );
  const itinerary = iRes.rows[0];
  if (!itinerary) return null;

  const eRes = await client.query(
    `SELECT id, sequence, title, venue_id, start_at, end_at, notes
       FROM core.itinerary_event
      WHERE itinerary_id = $1
      ORDER BY sequence, start_at`,
    [itineraryId]
  );
  return { ...itinerary, events: eRes.rows };
}

export async function createVersion(client, itineraryId, userId, changeSummary) {
  const agg = await loadItineraryAggregate(client, itineraryId);
  if (!agg) throw new Error('Itinerary not found');
  const nextVersion = (agg.current_version || 0) + 1;
  await client.query(
    `INSERT INTO core.itinerary_version
       (itinerary_id, version_number, changed_by, change_summary, snapshot)
     VALUES ($1,$2,$3,$4,$5)`,
    [itineraryId, nextVersion, userId, changeSummary || null, JSON.stringify(agg)]
  );
  await client.query(
    `UPDATE core.itinerary
        SET current_version = $2, updated_at = now()
      WHERE id = $1`,
    [itineraryId, nextVersion]
  );
  return nextVersion;
}

export async function restoreVersion(client, itineraryId, versionNumber, userId) {
  const vRes = await client.query(
    `SELECT snapshot FROM core.itinerary_version
      WHERE itinerary_id = $1 AND version_number = $2`,
    [itineraryId, versionNumber]
  );
  const snapshot = vRes.rows[0]?.snapshot;
  if (!snapshot) throw Object.assign(new Error('Version not found'), { status: 404 });

  await client.query(
    `DELETE FROM core.itinerary_event WHERE itinerary_id = $1`,
    [itineraryId]
  );
  await client.query(
    `UPDATE core.itinerary
        SET name = $2, itinerary_date = $3, updated_at = now()
      WHERE id = $1`,
    [itineraryId, snapshot.name, snapshot.itinerary_date]
  );
  for (const e of snapshot.events || []) {
    await client.query(
      `INSERT INTO core.itinerary_event
         (itinerary_id, sequence, title, venue_id, start_at, end_at, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [itineraryId, e.sequence, e.title, e.venue_id, e.start_at, e.end_at, e.notes]
    );
  }
  return createVersion(client, itineraryId, userId, `Restored from v${versionNumber}`);
}
