import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import { withTransaction } from './db.js';
import { sweepExpiredReservations } from './services/inventory.js';
import { sweepPaymentRetries } from './services/payment_intake.js';
import { archiveOldWorkflows } from './services/workflow_engine.js';
import { tickScheduler as tickIngestion } from './services/ingestion_scheduler.js';
import authPlugin from './auth/plugin.js';
import auditMutationsPlugin from './middleware/audit_mutations.js';
import auditRoutes from './routes/audit.js';
import integrationRoutes from './routes/integrations.js';
import authRoutes from './routes/auth.js';
import candidateRoutes from './routes/candidates.js';
import financeRoutes from './routes/finance.js';
import adminRoutes from './routes/admin.js';
import venueRoutes from './routes/venues.js';
import itineraryRoutes from './routes/itineraries.js';
import itineraryTemplateRoutes from './routes/itinerary_templates.js';
import eventRoutes from './routes/events.js';
import orderRoutes from './routes/orders.js';
import warehouseRoutes from './routes/warehouses.js';
import itemRoutes from './routes/items.js';
import inventoryRoutes from './routes/inventory.js';
import paymentRoutes from './routes/payments.js';
import paymentIntakeRoutes from './routes/payment_intake.js';
import workflowRoutes from './routes/workflows.js';
import workflowEngineRoutes from './routes/workflow_engine.js';
import vendorRoutes from './routes/vendors.js';
import ingestionRoutes from './routes/ingestion.js';
import ingestionSourceRoutes from './routes/ingestion_sources.js';

const app = Fastify({ logger: { level: config.logLevel } });

await app.register(cors, { origin: config.corsOrigin, credentials: true });
await app.register(authPlugin);
await app.register(auditMutationsPlugin);

app.get('/health', async () => ({
  status: 'ok',
  service: 'roadshowops-backend',
  time: new Date().toISOString()
}));

await app.register(authRoutes);
await app.register(candidateRoutes);
await app.register(financeRoutes);
await app.register(adminRoutes);
await app.register(venueRoutes);
await app.register(itineraryRoutes);
await app.register(itineraryTemplateRoutes);
await app.register(eventRoutes);
await app.register(orderRoutes);
await app.register(warehouseRoutes);
await app.register(itemRoutes);
await app.register(inventoryRoutes);
await app.register(paymentRoutes);
await app.register(paymentIntakeRoutes);
await app.register(workflowRoutes);
await app.register(workflowEngineRoutes);
await app.register(vendorRoutes);
await app.register(ingestionRoutes);
await app.register(ingestionSourceRoutes);
await app.register(auditRoutes);
await app.register(integrationRoutes);

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// Background sweeps:
//  1. Release reservations whose 60-min payment window has lapsed.
//  2. Retry failed payment intakes (up to PAYMENT_RETRY_MAX attempts,
//     PAYMENT_RETRY_INTERVAL_MINUTES apart).
const SWEEP_INTERVAL_MS = 60_000;
const sweepTimer = setInterval(async () => {
  try {
    const result = await withTransaction((c) => sweepExpiredReservations(c, null));
    if (result.released > 0) {
      app.log.info({ released: result.released }, 'Reservation sweep released expired holds');
    }
  } catch (e) {
    app.log.error({ err: e }, 'Reservation sweep failed');
  }

  try {
    const result = await withTransaction((c) => sweepPaymentRetries(c, null));
    if (result.processed > 0) {
      app.log.info({ processed: result.processed }, 'Payment retry sweep ran');
    }
  } catch (e) {
    app.log.error({ err: e }, 'Payment retry sweep failed');
  }

  try {
    const result = await withTransaction((c) => archiveOldWorkflows(c));
    if (result.archived > 0) {
      app.log.info({ archived: result.archived }, 'Archived workflow instances older than 90 days');
    }
  } catch (e) {
    app.log.error({ err: e }, 'Workflow archival sweep failed');
  }
}, SWEEP_INTERVAL_MS);
sweepTimer.unref?.();

// Ingestion scheduler: fires every INGESTION_SCHEDULER_INTERVAL_MINUTES (default 5).
// Each tick only runs sources whose min_interval_hours has elapsed since last run.
const ingestionTimer = setInterval(async () => {
  try {
    const result = await withTransaction((c) => tickIngestion(c, null));
    if (result.checked > 0) {
      app.log.info({ checked: result.checked, runs: result.runs.length }, 'Ingestion scheduler tick');
    }
  } catch (e) {
    app.log.error({ err: e }, 'Ingestion scheduler failed');
  }
}, config.ingestionSchedulerIntervalMinutes * 60_000);
ingestionTimer.unref?.();

const shutdown = async (signal) => {
  app.log.info({ signal }, 'Shutting down');
  clearInterval(sweepTimer);
  clearInterval(ingestionTimer);
  await app.close();
  process.exit(0);
};
process.once('SIGINT',  () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
