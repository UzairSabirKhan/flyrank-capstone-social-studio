import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PublishError } from '../src/adapters/SocialPublisher';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/db';
import { publishSlot } from '../src/modules/scheduling/publish';
import { CountingPublisher } from './fakes';
import { createSlot, resetDb } from './helpers';

const app = createApp();

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe('idempotent publish', () => {
  it('publishes exactly once when the same slot is published 10 times in parallel', async () => {
    const { slotId, variantId } = await createSlot(app);
    const publisher = new CountingPublisher();

    const results = await Promise.all(
      Array.from({ length: 10 }, () => publishSlot(slotId, publisher)),
    );

    expect(publisher.calls).toHaveLength(1); // the adapter was reached ONCE
    expect(results.filter((r) => r.outcome === 'published')).toHaveLength(1);
    expect(results.filter((r) => r.outcome === 'noop')).toHaveLength(9);

    const attempts = await prisma.publishAttempt.findMany({ where: { slotId } });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.result).toBe('published');
    expect(attempts[0]?.externalId).toBe('fake-1');
    expect((await prisma.slot.findUniqueOrThrow({ where: { id: slotId } })).status).toBe(
      'published',
    );
    expect((await prisma.variant.findUniqueOrThrow({ where: { id: variantId } })).status).toBe(
      'published',
    );
  });

  it('does not call the adapter again once a slot is published', async () => {
    const { slotId } = await createSlot(app);
    const publisher = new CountingPublisher();
    await publishSlot(slotId, publisher);
    const again = await publishSlot(slotId, publisher);
    expect(again.outcome).toBe('noop');
    expect(publisher.calls).toHaveLength(1);
  });

  it('refuses to publish if the variant is no longer approved', async () => {
    const { slotId, variantId } = await createSlot(app);
    await prisma.variant.update({ where: { id: variantId }, data: { status: 'draft' } });
    const publisher = new CountingPublisher();

    const result = await publishSlot(slotId, publisher);

    expect(result.outcome).toBe('skipped');
    expect(publisher.calls).toHaveLength(0);
    expect((await prisma.slot.findUniqueOrThrow({ where: { id: slotId } })).status).toBe('failed');
  });

  it('records an unknown outcome when the platform times out', async () => {
    const { slotId, variantId } = await createSlot(app);
    const publisher = new CountingPublisher(new PublishError('timeout', 'unknown'));

    const result = await publishSlot(slotId, publisher);

    expect(result.outcome).toBe('failed');
    const [attempt] = await prisma.publishAttempt.findMany({ where: { slotId } });
    expect(attempt?.result).toBe('unknown');
    expect((await prisma.slot.findUniqueOrThrow({ where: { id: slotId } })).status).toBe('failed');
    expect((await prisma.variant.findUniqueOrThrow({ where: { id: variantId } })).status).toBe(
      'approved',
    );
  });

  it('records a platform rejection as failed', async () => {
    const { slotId } = await createSlot(app);
    await publishSlot(slotId, new CountingPublisher(new PublishError('bad request', 'rejected')));
    const [attempt] = await prisma.publishAttempt.findMany({ where: { slotId } });
    expect(attempt?.result).toBe('failed');
    expect(attempt?.error).toBe('bad request');
  });

  it('rejects an unknown slot with 404', async () => {
    await expect(publishSlot('nope', new CountingPublisher())).rejects.toMatchObject({
      status: 404,
    });
  });

  it('lets the database itself refuse a second success for one slot', async () => {
    const { slotId } = await createSlot(app);
    await prisma.publishAttempt.create({ data: { slotId, result: 'published' } });
    await expect(
      prisma.publishAttempt.create({ data: { slotId, result: 'published' } }),
    ).rejects.toThrow();
  });
});
