import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MockXPublisher } from '../src/adapters/mock';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/db';
import { recoverStaleSlot } from '../src/modules/scheduling/recover';
import { sweep } from '../src/modules/scheduling/sweep';
import { CountingPublisher } from './fakes';
import { createSlot, inMinutes, makeDue, makeStale, resetDb } from './helpers';

const app = createApp();
const STALE = 60_000;

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe('sweep', () => {
  it('enqueues only due slots', async () => {
    const due = await createSlot(app);
    await createSlot(app); // due in 5 minutes
    await makeDue(due.slotId);
    const enqueued: string[] = [];
    const summary = await sweep({
      publisher: new CountingPublisher(undefined, true),
      staleAfterMs: STALE,
      enqueue: async (id) => {
        enqueued.push(id);
      },
    });
    expect(enqueued).toEqual([due.slotId]);
    expect(summary.enqueued).toBe(1);
  });
});

describe('stale slot recovery', () => {
  it('finishes a crash-after-send exactly once when the adapter dedupes by key', async () => {
    const { slotId } = await createSlot(app);
    await makeStale(slotId);
    const slot = await prisma.slot.findUniqueOrThrow({ where: { id: slotId } });
    // The crash happened AFTER the post was sent:
    await prisma.mockPost.create({
      data: { platform: 'mock_x', text: 'sent', preview: 'p', idempotencyKey: slot.idempotencyKey },
    });

    const result = await recoverStaleSlot(slotId, new MockXPublisher(), STALE);

    expect(result).toBe('recovered');
    expect(await prisma.mockPost.count()).toBe(1); // no second post
    const attempts = await prisma.publishAttempt.findMany({ where: { slotId } });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.result).toBe('published');
    expect((await prisma.slot.findUniqueOrThrow({ where: { id: slotId } })).status).toBe(
      'published',
    );
  });

  it('never re-sends when the adapter cannot dedupe, and flags it for a human', async () => {
    const { slotId, variantId } = await createSlot(app);
    await makeStale(slotId);
    const publisher = new CountingPublisher(); // dedupesByKey = false

    expect(await recoverStaleSlot(slotId, publisher, STALE)).toBe('needs_review');
    expect(publisher.calls).toHaveLength(0);
    expect((await prisma.slot.findUniqueOrThrow({ where: { id: slotId } })).status).toBe('failed');
    const [attempt] = await prisma.publishAttempt.findMany({ where: { slotId } });
    expect(attempt?.result).toBe('unknown');

    // The variant cannot be scheduled again until a human resolves it.
    const blocked = await request(app)
      .post(`/variants/${variantId}/schedule`)
      .send({ scheduledAt: inMinutes(5) });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('OUTCOME_UNKNOWN');

    const resolved = await request(app)
      .post(`/slots/${slotId}/resolve`)
      .send({ outcome: 'not_posted' });
    expect(resolved.status).toBe(200);
    const again = await request(app)
      .post(`/variants/${variantId}/schedule`)
      .send({ scheduledAt: inMinutes(5) });
    expect(again.status).toBe(201);
  });

  it('marks the variant published when an operator confirms it was posted', async () => {
    const { slotId, variantId } = await createSlot(app);
    await makeStale(slotId);
    await recoverStaleSlot(slotId, new CountingPublisher(), STALE);

    const res = await request(app)
      .post(`/slots/${slotId}/resolve`)
      .send({ outcome: 'posted', externalUrl: 'https://discord.com/channels/1/2/3' });
    expect(res.status).toBe(200);
    expect((await prisma.variant.findUniqueOrThrow({ where: { id: variantId } })).status).toBe(
      'published',
    );
    expect(res.body.slot.attempts[0].externalId).toBe('manual');
    expect(
      (await request(app).post(`/slots/${slotId}/resolve`).send({ outcome: 'posted' })).status,
    ).toBe(409);
  });

  it('ignores a slot that is not stale', async () => {
    const { slotId } = await createSlot(app);
    await makeStale(slotId, 1_000); // claimed one second ago
    expect(await recoverStaleSlot(slotId, new CountingPublisher(undefined, true), STALE)).toBe(
      'skipped',
    );
  });

  it('lets exactly one of two concurrent recoverers act', async () => {
    const { slotId } = await createSlot(app);
    await makeStale(slotId);
    const publisher = new CountingPublisher(undefined, true);
    const results = await Promise.all([
      recoverStaleSlot(slotId, publisher, STALE),
      recoverStaleSlot(slotId, publisher, STALE),
    ]);
    expect(results.sort()).toEqual(['recovered', 'skipped']);
    expect(publisher.calls).toHaveLength(1);
  });
});
