import { PgBoss } from 'pg-boss';
import { createPublisher } from './adapters/registry';
import { loadConfig } from './config';
import { prisma } from './lib/db';
import { logger } from './lib/logger';
import { publishSlot } from './modules/scheduling/publish';
import { sweep } from './modules/scheduling/sweep';

const PUBLISH_QUEUE = 'publish-slot';
const SWEEP_QUEUE = 'sweep';

const config = loadConfig();
const publisher = createPublisher(config);
const staleAfterMs = config.STALE_AFTER_SECONDS * 1000;

const boss = new PgBoss(config.DATABASE_URL);
boss.on('error', (err) => logger.error({ err }, 'pg-boss error'));
await boss.start();
await boss.createQueue(PUBLISH_QUEUE);
await boss.createQueue(SWEEP_QUEUE);

async function runSweep() {
  try {
    const summary = await sweep({
      publisher,
      staleAfterMs,
      enqueue: async (slotId) => {
        // retryLimit 0: our own DB-driven retry policy decides what happens next.
        await boss.send(PUBLISH_QUEUE, { slotId }, { retryLimit: 0, expireInSeconds: 300 });
      },
    });
    logger.info(summary, 'sweep finished');
  } catch (err) {
    logger.error({ err }, 'sweep failed'); // the next sweep re-derives everything from the DB
  }
}

await boss.work<{ slotId: string }>(PUBLISH_QUEUE, { pollingIntervalSeconds: 2 }, async (jobs) => {
  for (const job of jobs) {
    const { slotId } = job.data;
    try {
      const result = await publishSlot(slotId, publisher, { requireDue: true });
      logger.info({ slotId, outcome: result.outcome }, 'publish job finished');
    } catch (err) {
      // Never throw: the slot's state in the database is the truth, and the sweep reconciles it.
      logger.error({ err, slotId }, 'publish job errored');
    }
  }
});

await boss.work(SWEEP_QUEUE, { pollingIntervalSeconds: 5 }, async () => {
  await runSweep();
});
await boss.schedule(SWEEP_QUEUE, '* * * * *', {}); // every minute; stored in Postgres

logger.info({ publisher: publisher.name, staleAfterMs }, 'Worker started');
await runSweep(); // catch up immediately after a restart instead of waiting up to a minute

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'Worker shutting down');
  await boss.stop({ graceful: true, timeout: 30_000 });
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
