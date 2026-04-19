// Inventory operations: atomic, row-locked, append-only-ledger-backed.
// Every mutation writes (a) stock_movement and (b) audit.stock_ledger with
// who/when/why/before/after. Ledger rows are made immutable via DB triggers.

function err(status, message) {
  return Object.assign(new Error(message), { status });
}

async function lockStock(client, itemId, locationId) {
  const res = await client.query(
    `SELECT on_hand, reserved FROM core.stock
      WHERE item_id = $1 AND location_id = $2 FOR UPDATE`,
    [itemId, locationId]
  );
  const r = res.rows[0];
  return r
    ? { on_hand: Number(r.on_hand), reserved: Number(r.reserved) }
    : { on_hand: 0, reserved: 0 };
}

async function insertMovement(client, userId, m) {
  const { rows } = await client.query(
    `INSERT INTO core.stock_movement
       (movement_type, item_id, from_location_id, to_location_id,
        quantity, reference_type, reference_id, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id`,
    [
      m.movement_type, m.item_id,
      m.from_location_id ?? null, m.to_location_id ?? null,
      m.quantity,
      m.reference_type ?? null, m.reference_id ?? null,
      m.notes ?? null, userId ?? null
    ]
  );
  return rows[0].id;
}

async function writeLedger(client, userId, entry) {
  await client.query(
    `INSERT INTO audit.stock_ledger
       (movement_id, item_id, location_id, actor_user_id, reason,
        on_hand_before, on_hand_after, reserved_before, reserved_after,
        reference_type, reference_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      entry.movement_id, entry.item_id, entry.location_id, userId ?? null,
      entry.reason,
      entry.before.on_hand, entry.after.on_hand,
      entry.before.reserved, entry.after.reserved,
      entry.reference_type ?? null, entry.reference_id ?? null
    ]
  );
}

export async function locationCityId(client, locationId) {
  const { rows } = await client.query(
    `SELECT w.city_id
       FROM core.warehouse_location wl
       JOIN core.warehouse w ON w.id = wl.warehouse_id
      WHERE wl.id = $1`,
    [locationId]
  );
  return rows[0]?.city_id ?? null;
}

// ============================================================================
// Inbound
// ============================================================================
export async function recordInbound(client, userId, { item_id, location_id, quantity, reference_type, reference_id, notes }) {
  if (!item_id || !location_id || !Number.isInteger(quantity) || quantity <= 0) {
    throw err(400, 'item_id, location_id, positive integer quantity required');
  }
  const before = await lockStock(client, item_id, location_id);
  await client.query(
    `INSERT INTO core.stock (item_id, location_id, on_hand, reserved)
     VALUES ($1, $2, $3, 0)
     ON CONFLICT (item_id, location_id) DO UPDATE
       SET on_hand = core.stock.on_hand + EXCLUDED.on_hand,
           updated_at = now()`,
    [item_id, location_id, quantity]
  );
  const after = await lockStock(client, item_id, location_id);
  const movementId = await insertMovement(client, userId, {
    movement_type: 'inbound', item_id, to_location_id: location_id,
    quantity, reference_type, reference_id, notes
  });
  await writeLedger(client, userId, {
    movement_id: movementId, item_id, location_id,
    reason: `inbound${notes ? `: ${notes}` : ''}`,
    before, after, reference_type, reference_id
  });
  return after;
}

// ============================================================================
// Reservation (with optional 60-min expiry for orders)
// ============================================================================
export async function createReservation(client, userId, {
  item_id, location_id, quantity,
  reference_type, reference_id, expires_at = null
}) {
  if (!item_id || !location_id || !Number.isInteger(quantity) || quantity <= 0) {
    throw err(400, 'item_id, location_id, positive integer quantity required');
  }
  const before = await lockStock(client, item_id, location_id);
  const available = before.on_hand - before.reserved;
  if (quantity > available) {
    throw err(409, `Insufficient stock: requested ${quantity}, available ${available}`);
  }
  await client.query(
    `UPDATE core.stock
       SET reserved = reserved + $3, updated_at = now()
     WHERE item_id = $1 AND location_id = $2`,
    [item_id, location_id, quantity]
  );
  const after = await lockStock(client, item_id, location_id);
  const ins = await client.query(
    `INSERT INTO core.stock_reservation
       (item_id, location_id, quantity, reference_type, reference_id, expires_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, item_id, location_id, quantity, status, expires_at, created_at`,
    [item_id, location_id, quantity, reference_type ?? null, reference_id ?? null, expires_at, userId ?? null]
  );
  const reservationId = ins.rows[0].id;
  const movementId = await insertMovement(client, userId, {
    movement_type: 'reservation', item_id, to_location_id: location_id,
    quantity, reference_type: 'reservation', reference_id: String(reservationId)
  });
  await writeLedger(client, userId, {
    movement_id: movementId, item_id, location_id,
    reason: `reservation:create${reference_type ? `:${reference_type}#${reference_id}` : ''}`,
    before, after,
    reference_type: 'reservation', reference_id: String(reservationId)
  });
  return ins.rows[0];
}

async function loadReservation(client, reservationId) {
  const { rows } = await client.query(
    `SELECT id, item_id, location_id, quantity, status, expires_at, reference_type, reference_id
       FROM core.stock_reservation WHERE id = $1 FOR UPDATE`,
    [reservationId]
  );
  return rows[0] || null;
}

export async function releaseReservation(client, userId, reservationId, { cause = 'released' } = {}) {
  const r = await loadReservation(client, reservationId);
  if (!r) throw err(404, 'Reservation not found');
  if (r.status !== 'active') throw err(409, `Reservation is ${r.status}`);

  const before = await lockStock(client, r.item_id, r.location_id);
  await client.query(
    `UPDATE core.stock SET reserved = reserved - $3, updated_at = now()
      WHERE item_id = $1 AND location_id = $2`,
    [r.item_id, r.location_id, r.quantity]
  );
  const after = await lockStock(client, r.item_id, r.location_id);
  await client.query(
    `UPDATE core.stock_reservation SET status='released', updated_at = now() WHERE id = $1`,
    [reservationId]
  );
  const movementId = await insertMovement(client, userId, {
    movement_type: 'release', item_id: r.item_id, from_location_id: r.location_id,
    quantity: r.quantity, reference_type: 'reservation', reference_id: String(reservationId),
    notes: cause
  });
  await writeLedger(client, userId, {
    movement_id: movementId, item_id: r.item_id, location_id: r.location_id,
    reason: `reservation:release:${cause}`,
    before, after,
    reference_type: 'reservation', reference_id: String(reservationId)
  });
  return { id: reservationId, status: 'released', cause };
}

export async function confirmReservationsByReference(client, reference_type, reference_id) {
  await client.query(
    `UPDATE core.stock_reservation
        SET expires_at = NULL, updated_at = now()
      WHERE reference_type = $1 AND reference_id = $2::text AND status = 'active'`,
    [reference_type, String(reference_id)]
  );
}

export async function releaseReservationsByReference(client, userId, reference_type, reference_id, cause) {
  const { rows } = await client.query(
    `SELECT id FROM core.stock_reservation
      WHERE reference_type = $1 AND reference_id = $2::text AND status = 'active'
      FOR UPDATE`,
    [reference_type, String(reference_id)]
  );
  let released = 0;
  for (const r of rows) {
    await releaseReservation(client, userId, r.id, { cause });
    released++;
  }
  return released;
}

// ============================================================================
// Outbound (fulfillment) — consumes a reservation OR ships stock directly
// ============================================================================
export async function fulfillReservation(client, userId, reservationId) {
  const r = await loadReservation(client, reservationId);
  if (!r) throw err(404, 'Reservation not found');
  if (r.status !== 'active') throw err(409, `Reservation is ${r.status}`);

  const before = await lockStock(client, r.item_id, r.location_id);
  await client.query(
    `UPDATE core.stock
        SET on_hand  = on_hand  - $3,
            reserved = reserved - $3,
            updated_at = now()
      WHERE item_id = $1 AND location_id = $2`,
    [r.item_id, r.location_id, r.quantity]
  );
  const after = await lockStock(client, r.item_id, r.location_id);
  await client.query(
    `UPDATE core.stock_reservation SET status='fulfilled', updated_at=now() WHERE id = $1`,
    [reservationId]
  );
  const movementId = await insertMovement(client, userId, {
    movement_type: 'fulfill', item_id: r.item_id, from_location_id: r.location_id,
    quantity: r.quantity, reference_type: 'reservation', reference_id: String(reservationId)
  });
  await writeLedger(client, userId, {
    movement_id: movementId, item_id: r.item_id, location_id: r.location_id,
    reason: 'reservation:fulfill',
    before, after,
    reference_type: 'reservation', reference_id: String(reservationId)
  });
  return { id: reservationId, status: 'fulfilled' };
}

export async function recordDirectOutbound(client, userId, { item_id, location_id, quantity, reference_type, reference_id, notes }) {
  if (!item_id || !location_id || !Number.isInteger(quantity) || quantity <= 0) {
    throw err(400, 'item_id, location_id, positive integer quantity required');
  }
  const before = await lockStock(client, item_id, location_id);
  const available = before.on_hand - before.reserved;
  if (quantity > available) {
    throw err(409, `Insufficient stock: requested ${quantity}, available ${available}`);
  }
  await client.query(
    `UPDATE core.stock SET on_hand = on_hand - $3, updated_at = now()
      WHERE item_id = $1 AND location_id = $2`,
    [item_id, location_id, quantity]
  );
  const after = await lockStock(client, item_id, location_id);
  const movementId = await insertMovement(client, userId, {
    movement_type: 'outbound', item_id, from_location_id: location_id,
    quantity, reference_type, reference_id, notes
  });
  await writeLedger(client, userId, {
    movement_id: movementId, item_id, location_id,
    reason: `outbound${notes ? `: ${notes}` : ''}`,
    before, after, reference_type, reference_id
  });
  return after;
}

// ============================================================================
// Transfer (locks both rows in consistent order; 2 ledger entries)
// ============================================================================
export async function recordTransfer(client, userId, { item_id, from_location_id, to_location_id, quantity, reference_type, reference_id, notes }) {
  if (!item_id || !from_location_id || !to_location_id || !Number.isInteger(quantity) || quantity <= 0) {
    throw err(400, 'item_id, from_location_id, to_location_id, positive integer quantity required');
  }
  if (from_location_id === to_location_id) throw err(400, 'from_location and to_location must differ');

  const [lo, hi] = from_location_id < to_location_id
    ? [from_location_id, to_location_id]
    : [to_location_id, from_location_id];
  await client.query(
    `SELECT item_id, location_id FROM core.stock
      WHERE item_id = $1 AND location_id IN ($2,$3)
      ORDER BY location_id FOR UPDATE`,
    [item_id, lo, hi]
  );

  const srcBefore = await lockStock(client, item_id, from_location_id);
  const dstBefore = await lockStock(client, item_id, to_location_id);
  const available = srcBefore.on_hand - srcBefore.reserved;
  if (quantity > available) {
    throw err(409, `Insufficient available stock at source: requested ${quantity}, available ${available}`);
  }

  await client.query(
    `UPDATE core.stock SET on_hand = on_hand - $3, updated_at = now()
      WHERE item_id = $1 AND location_id = $2`,
    [item_id, from_location_id, quantity]
  );
  await client.query(
    `INSERT INTO core.stock (item_id, location_id, on_hand, reserved)
     VALUES ($1,$2,$3,0)
     ON CONFLICT (item_id, location_id) DO UPDATE
       SET on_hand = core.stock.on_hand + EXCLUDED.on_hand, updated_at = now()`,
    [item_id, to_location_id, quantity]
  );

  const srcAfter = await lockStock(client, item_id, from_location_id);
  const dstAfter = await lockStock(client, item_id, to_location_id);

  const movementId = await insertMovement(client, userId, {
    movement_type: 'transfer', item_id,
    from_location_id, to_location_id,
    quantity, reference_type, reference_id, notes
  });
  await writeLedger(client, userId, {
    movement_id: movementId, item_id, location_id: from_location_id,
    reason: `transfer:out${notes ? `: ${notes}` : ''}`,
    before: srcBefore, after: srcAfter, reference_type, reference_id
  });
  await writeLedger(client, userId, {
    movement_id: movementId, item_id, location_id: to_location_id,
    reason: `transfer:in${notes ? `: ${notes}` : ''}`,
    before: dstBefore, after: dstAfter, reference_type, reference_id
  });
  return { source: srcAfter, destination: dstAfter };
}

// ============================================================================
// Cycle count (adjusts on_hand to counted_qty; ledger captures variance)
// ============================================================================
export async function recordCycleCount(client, userId, { item_id, location_id, counted_qty: cq, counted_quantity, notes }) {
  const counted_qty = cq ?? counted_quantity;
  if (!item_id || !location_id || !Number.isInteger(counted_qty) || counted_qty < 0) {
    throw err(400, 'item_id, location_id, non-negative integer counted_qty required');
  }
  const before = await lockStock(client, item_id, location_id);
  const expected = before.on_hand;
  const variance = counted_qty - expected;

  if (counted_qty < before.reserved) {
    throw err(409,
      `Counted qty ${counted_qty} is below reserved qty ${before.reserved}; release reservations first`);
  }

  await client.query(
    `INSERT INTO core.stock (item_id, location_id, on_hand, reserved)
     VALUES ($1,$2,$3,0)
     ON CONFLICT (item_id, location_id) DO UPDATE
       SET on_hand = EXCLUDED.on_hand, updated_at = now()`,
    [item_id, location_id, counted_qty]
  );
  const after = await lockStock(client, item_id, location_id);

  const cc = await client.query(
    `INSERT INTO core.cycle_count
       (item_id, location_id, expected_qty, counted_qty, variance, notes, counted_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, expected_qty, counted_qty, variance, counted_at`,
    [item_id, location_id, expected, counted_qty, variance, notes ?? null, userId]
  );

  let movementId = null;
  if (variance !== 0) {
    movementId = await insertMovement(client, userId, {
      movement_type: 'adjust', item_id,
      from_location_id: variance < 0 ? location_id : null,
      to_location_id:   variance > 0 ? location_id : null,
      quantity: variance,
      reference_type: 'cycle_count', reference_id: String(cc.rows[0].id), notes
    });
  }
  await writeLedger(client, userId, {
    movement_id: movementId, item_id, location_id,
    reason: `cycle_count:variance=${variance}${notes ? `: ${notes}` : ''}`,
    before, after,
    reference_type: 'cycle_count', reference_id: String(cc.rows[0].id)
  });
  return cc.rows[0];
}

// ============================================================================
// Sweep expired unpaid reservations
// ============================================================================
export async function sweepExpiredReservations(client, userId, { now = new Date() } = {}) {
  const { rows } = await client.query(
    `SELECT id FROM core.stock_reservation
      WHERE status = 'active'
        AND expires_at IS NOT NULL
        AND expires_at <= $1
      FOR UPDATE`,
    [now]
  );
  let released = 0;
  for (const r of rows) {
    await releaseReservation(client, userId, r.id, { cause: 'expired_unpaid' });
    released++;
  }
  return { released, checkedAt: now };
}
