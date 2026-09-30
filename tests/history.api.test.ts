import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MockXPublisher } from '../src/adapters/mock';
import type { SocialPublisher } from '../src/adapters/SocialPublisher';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/db';
import { publishSlot } from '../src/modules/scheduling/publish';
import { CountingPublisher } from './fakes';
import { createSlot, createVariant, inMinutes, resetDb } from './helpers';

const app = createApp();

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe('publish history', () => {
  it('lists attempts with platform, result and filters', async () => {
    const { slotId } = await createSlot(app);
    await publishSlot(slotId, new CountingPublisher());

    const res = await request(app).get('/history');
    expect(res.status).toBe(200);
    expect(res.body.history).toHaveLength(1);
    expect(res.body.history[0]).toMatchObject({
      slotId,
      platform: 'x',
      result: 'published',
      slotStatus: 'published',
    });
    expect((await request(app).get(`/history?slotId=${slotId}`)).body.history).toHaveLength(1);
    expect((await request(app).get('/history?slotId=nope')).body.history).toHaveLength(0);
    expect((await request(app).get('/history?limit=0')).status).toBe(400);
  });

  it('renders an HTML view and escapes stored content', async () => {
    const { slotId } = await createSlot(app);
    await publishSlot(slotId, new MockXPublisher());
    await prisma.mockPost.updateMany({ data: { preview: '<script>alert(1)</script>' } });

    const res = await request(app).get('/history/view');
    expect(res.status).toBe(200);
    expect(res.type).toBe('text/html');
    expect(res.text).not.toContain('<script>alert(1)</script>');
    expect(res.text).toContain('&lt;script&gt;');
  });
});

describe('target limits and production mode', () => {
  const tiny: SocialPublisher = {
    name: 'tiny',
    dedupesByKey: true,
    maxLength: 20,
    publish: async () => ({ externalId: 'x', url: null }),
  };

  it('refuses to schedule text longer than the target allows', async () => {
    const tinyApp = createApp({ publisher: tiny });
    const variantId = await createVariant(tinyApp, { approve: true });
    const res = await request(tinyApp)
      .post(`/variants/${variantId}/schedule`)
      .send({ scheduledAt: inMinutes(5) });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('TEXT_TOO_LONG_FOR_TARGET');
    expect(await prisma.slot.count()).toBe(0);
  });

  it('does not expose the manual publish endpoint when disabled', async () => {
    const prodApp = createApp({ publisher: tiny, enableManualPublish: false });
    expect((await request(prodApp).post('/slots/anything/publish')).status).toBe(404);
  });
});
