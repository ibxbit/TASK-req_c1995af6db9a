import { query, withTransaction } from '../db.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { requirePermission } from '../rbac/enforce.js';
import { logPermissionEvent } from '../rbac/audit.js';
import { requireFields } from '../middleware/validate.js';
import {
  encryptField,
  decryptField,
  maskEncryptedField,
  maskField
} from '../auth/crypto.js';

function send(reply, err) {
  if (err.status) return reply.code(err.status).send({ error: err.message });
  throw err;
}

export default async function vendorRoutes(app) {
  app.get(
    '/vendors',
    { preHandler: requirePermission(PERMISSIONS.VENDOR_READ) },
    async () => {
      const { rows } = await query(
        `SELECT id, code, legal_name, contact_email, contact_phone, status,
                (tax_id_encrypted IS NOT NULL) AS has_tax_id,
                (bank_routing_encrypted IS NOT NULL) AS has_bank_routing,
                bank_account_last4, created_at
           FROM core.vendor ORDER BY id DESC`
      );
      return rows.map((v) => ({
        ...v,
        bank_account_masked: v.bank_account_last4 ? `****${v.bank_account_last4}` : null
      }));
    }
  );

  app.post(
    '/vendors',
    {
      preHandler: [
        requirePermission(PERMISSIONS.VENDOR_WRITE),
        requireFields(['code', 'legal_name'])
      ]
    },
    async (request, reply) => {
      const { code, legal_name, contact_email, contact_phone } = request.body;
      const { rows } = await query(
        `INSERT INTO core.vendor (code, legal_name, contact_email, contact_phone, created_by)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id, code, legal_name, contact_email, contact_phone, status, created_at`,
        [code, legal_name, contact_email ?? null, contact_phone ?? null, request.user.id]
      );
      return reply.code(201).send(rows[0]);
    }
  );

  // =====================================================================
  // BANKING — masked read; write is gated by vendor.banking.write;
  // decrypted reveal is gated by vendor.banking.read and audit-logged.
  // =====================================================================
  app.get(
    '/vendors/:id/banking',
    { preHandler: requirePermission(PERMISSIONS.VENDOR_READ) },
    async (request, reply) => {
      const { rows } = await query(
        `SELECT id, tax_id_encrypted, bank_routing_encrypted,
                bank_account_encrypted, bank_account_last4, updated_at
           FROM core.vendor WHERE id = $1`,
        [request.params.id]
      );
      const v = rows[0];
      if (!v) return reply.code(404).send({ error: 'Not found' });
      try {
        return {
          vendor_id: v.id,
          tax_id:          maskEncryptedField(v.tax_id_encrypted,       { show: 4 }),
          bank_routing:    maskEncryptedField(v.bank_routing_encrypted, { show: 4 }),
          bank_account:    v.bank_account_last4 ? `****${v.bank_account_last4}` : null,
          updated_at:      v.updated_at
        };
      } catch (e) { return send(reply, e); }
    }
  );

  app.put(
    '/vendors/:id/banking',
    { preHandler: requirePermission(PERMISSIONS.VENDOR_BANKING_WRITE) },
    async (request, reply) => {
      const { tax_id, bank_routing, bank_account } = request.body || {};
      try {
        const taxEnc  = tax_id       != null ? encryptField(String(tax_id))       : null;
        const rtEnc   = bank_routing != null ? encryptField(String(bank_routing)) : null;
        const acctEnc = bank_account != null ? encryptField(String(bank_account)) : null;
        const last4   = bank_account != null
          ? String(bank_account).replace(/\D/g, '').slice(-4) || null
          : null;

        const { rows } = await query(
          `UPDATE core.vendor
              SET tax_id_encrypted       = COALESCE($2, tax_id_encrypted),
                  bank_routing_encrypted = COALESCE($3, bank_routing_encrypted),
                  bank_account_encrypted = COALESCE($4, bank_account_encrypted),
                  bank_account_last4     = COALESCE($5, bank_account_last4),
                  updated_at             = now()
            WHERE id = $1
            RETURNING id, bank_account_last4`,
          [request.params.id, taxEnc, rtEnc, acctEnc, last4]
        );
        if (!rows[0]) return reply.code(404).send({ error: 'Not found' });

        await logPermissionEvent({
          user: request.user, permissionCode: PERMISSIONS.VENDOR_BANKING_WRITE,
          resource: `vendor:${request.params.id}:banking`,
          action: 'vendor.banking.update', granted: true, request,
          metadata: {
            tax_id_set:       tax_id != null,
            bank_routing_set: bank_routing != null,
            bank_account_set: bank_account != null
          }
        });
        return reply.code(200).send({
          vendor_id: rows[0].id,
          bank_account_last4: rows[0].bank_account_last4
        });
      } catch (e) { return send(reply, e); }
    }
  );

  app.post(
    '/vendors/:id/banking/reveal',
    { preHandler: requirePermission(PERMISSIONS.VENDOR_BANKING_READ) },
    async (request, reply) => {
      // Optional justification logged in every audit event for this action.
      const { reason } = request.body || {};
      const { rows } = await query(
        `SELECT id, tax_id_encrypted, bank_routing_encrypted, bank_account_encrypted
           FROM core.vendor WHERE id = $1`,
        [request.params.id]
      );
      const v = rows[0];
      if (!v) return reply.code(404).send({ error: 'Not found' });
      try {
        const revealed = {
          vendor_id: v.id,
          tax_id:       v.tax_id_encrypted       ? decryptField(v.tax_id_encrypted)       : null,
          bank_routing: v.bank_routing_encrypted ? decryptField(v.bank_routing_encrypted) : null,
          bank_account: v.bank_account_encrypted ? decryptField(v.bank_account_encrypted) : null
        };
        await logPermissionEvent({
          user: request.user, permissionCode: PERMISSIONS.VENDOR_BANKING_READ,
          resource: `vendor:${request.params.id}:banking`,
          action: 'vendor.banking.reveal', granted: true, request,
          metadata: {
            revealed_fields: Object.entries(revealed)
              .filter(([k, val]) => k !== 'vendor_id' && val !== null)
              .map(([k]) => k),
            reason: reason ?? null
          }
        });
        return revealed;
      } catch (e) { return send(reply, e); }
    }
  );
}

// Named helper used by higher-level callers / tests.
export { maskField };
