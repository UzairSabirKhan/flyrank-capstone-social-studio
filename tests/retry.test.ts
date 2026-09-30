import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PublishError } from '../src/adapters/SocialPublisher';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/db';
import { MAX_ATTEMPTS, publishSlot } from '../src/modules/scheduling/publish';
import { CountingPublisher } from './fakes';
import { createSlot, makeDue, resetDb } from './helpers';

const app = createApp();
const rateLimited = () => new PublishError('rate limited', 'rejected', true);
const slotOf = (id: string) => prisma.slot.findUniqueOrThrow({ where: { id } });

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe('retry policy', () => {
  it('reschedules a retryable rejection with a backoff', async () => {
    const { slotId } = await createSlot(app);
    const result = await publishSlot(slotId, new CountingPublisher(rateLimited()));
    expect(result.outcome).toBe('retry_scheduled');
    const slot = await slotOf(slotId);
    expect(slot.status).toBe('scheduled');
    expect(slot.scheduledAt.getTime()).toBeGreaterThan(Date.now() + 20_000);
    expect(slot.scheduledAt.getTime()).toBeLessThan(Date.now() + 60_000);
    const [attempt] = await prisma.publishAttempt.findMany({ where: { slotId } });
    expect(attempt?.error).toContain('will retry');
  });

  it('does not retry a permanent rejection', async () => {
    const { slotId } = await createSlot(app);
    const result = await publishSlot(
      slotId,
      new CountingPublisher(new PublishError('bad request', 'rejected')),
    );
    expect(result.outcome).toBe('failed');
    expect((await slotOf(slotId)).status).toBe('failed');
  });

  it('retries an unknown outcome only when the adapter dedupes by key', async () => {
    const unknown = () => new PublishError('timeout', 'unknown');

    const a = await createSlot(app);
    expect((await publishSlot(a.slotId, new CountingPublisher(unknown(), true))).outcome).toBe(
      'retry_scheduled',
    );

    const b = await createSlot(app);
    expect((await publishSlot(b.slotId, new CountingPublisher(unknown(), false))).outcome).toBe(
      'failed',
    );
  });

  it('gives up after the maximum number of attempts', async () => {
    const { slotId } = await createSlot(app);
    const publisher = new CountingPublisher(rateLimited());
    const outcomes: string[] = [];
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await makeDue(slotId);
      outcomes.push((await publishSlot(slotId, publisher, { requireDue: true })).outcome);
    }
    expect(outcomes).toEqual([...Array(MAX_ATTEMPTS - 1).fill('retry_scheduled'), 'failed']);
    expect((await slotOf(slotId)).status).toBe('failed');
    expect(await prisma.publishAttempt.count({ where: { slotId } })).toBe(MAX_ATTEMPTS);
  });

  it('does not publish a slot that is not due yet when requireDue is set', async () => {
    const { slotId } = await createSlot(app); // due in 5 minutes
    const publisher = new CountingPublisher();
    expect((await publishSlot(slotId, publisher, { requireDue: true })).outcome).toBe('noop');
    expect(publisher.calls).toHaveLength(0);

    await makeDue(slotId);
    expect((await publishSlot(slotId, publisher, { requireDue: true })).outcome).toBe('published');
    expect(publisher.calls).toHaveLength(1);
  });
});
