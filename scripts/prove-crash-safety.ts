import 'dotenv/config';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { prisma } from '../src/lib/db';

const N = 5;
const runId = Date.now();
// A mock adapter (dedupes by key). The delay sleeps AFTER the send: the crash window.
const env = {
  ...process.env,
  NODE_ENV: 'development',
  PUBLISHER: 'mock_x',
  PUBLISH_DELAY_MS: '4000',
  STALE_AFTER_SECONDS: '5',
};

const startWorker = (): ChildProcess =>
  spawn(process.execPath, ['--import', 'tsx', 'src/worker.ts'], { env, stdio: 'inherit' });

async function waitFor(label: string, check: () => Promise<boolean>, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

// Seed straight into the database (a proof harness, so it bypasses the API guards on purpose).
const slotIds: string[] = [];
const keys: string[] = [];
for (let i = 1; i <= N; i++) {
  const post = await prisma.post.create({
    data: {
      sourceType: 'markdown',
      title: `crash proof ${runId} #${i}`,
      bodyMarkdown: 'Crash proof post body for the recovery test.',
    },
  });
  const variant = await prisma.variant.create({
    data: {
      postId: post.id,
      platform: 'x',
      text: `Crash proof ${runId} number ${i} #Proof`,
      status: 'approved',
    },
  });
  const key = `${variant.id}:proof-${runId}-${i}`;
  const slot = await prisma.slot.create({
    data: { variantId: variant.id, scheduledAt: new Date(Date.now() - 1000), idempotencyKey: key },
  });
  slotIds.push(slot.id);
  keys.push(key);
}
console.log(`Seeded ${N} due slots.`);

let worker = startWorker();
let failed = false;
try {
  await waitFor(
    'a post to be sent while the worker is still busy',
    async () =>
      (await prisma.slot.count({ where: { id: { in: slotIds }, status: 'publishing' } })) >= 1 &&
      (await prisma.mockPost.count({ where: { idempotencyKey: { in: keys } } })) >= 1,
    90_000,
  );
  console.log('\n>>> KILLING the worker mid-publish (post sent, not yet recorded)\n');
  worker.kill('SIGKILL');
  await sleep(7_000); // longer than STALE_AFTER_SECONDS=5

  console.log('>>> RESTARTING the worker\n');
  worker = startWorker();
  await waitFor(
    'every slot to be published',
    async () =>
      (await prisma.slot.count({ where: { id: { in: slotIds }, status: 'published' } })) === N,
    180_000,
  );

  console.log('\n=== RESULT ===');
  for (const [i, slotId] of slotIds.entries()) {
    const ok = await prisma.publishAttempt.count({ where: { slotId, result: 'published' } });
    const posts = await prisma.mockPost.count({ where: { idempotencyKey: keys[i]! } });
    console.log(`slot ${i + 1}: successful attempts=${ok}, posts created=${posts}`);
    if (ok !== 1 || posts !== 1) failed = true;
  }
  const total = await prisma.mockPost.count({ where: { idempotencyKey: { in: keys } } });
  console.log(`total posts for ${N} slots: ${total}`);
  if (total !== N) failed = true;
  console.log(
    failed
      ? '\nFAIL: duplicates or missing posts'
      : '\nPASS: exactly one post per slot, zero duplicates',
  );
} catch (err) {
  failed = true;
  console.error(err);
} finally {
  worker.kill();
  await prisma.mockPost.deleteMany({ where: { idempotencyKey: { in: keys } } });
  await prisma.post.deleteMany({ where: { title: { startsWith: `crash proof ${runId}` } } });
  await prisma.$disconnect();
  process.exitCode = failed ? 1 : 0;
}
