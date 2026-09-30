import request from 'supertest';
import type { Express } from 'express';
import { prisma } from '../src/lib/db';

export const markdown = `# Idempotency

Publishing systems retry on failure. A retry after a timeout must never create a second post.
Idempotency keys let the server recognise a repeated request and ignore it. This is why the
database, not the application code, should enforce uniqueness. Teams that skip this step end up
with duplicate posts and angry customers.`;

export async function resetDb() {
  await prisma.mockPost.deleteMany();
  await prisma.post.deleteMany(); // cascades to variants, slots, attempts
}

export const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

export async function createVariant(
  app: Express,
  opts: { approve?: boolean; platform?: 'x' | 'linkedin' } = {},
) {
  const { approve = false, platform = 'x' } = opts;
  const p = await request(app)
    .post('/posts')
    .send({ sourceType: 'markdown', title: 'Why Idempotency Matters', markdown });
  const g = await request(app)
    .post(`/posts/${p.body.post.id}/variants/generate`)
    .send({ platforms: [platform] });
  const variantId = g.body.created[0].id as string;
  if (approve) await request(app).post(`/variants/${variantId}/approve`);
  return variantId;
}

export async function createSlot(app: Express) {
  const variantId = await createVariant(app, { approve: true });
  const res = await request(app)
    .post(`/variants/${variantId}/schedule`)
    .send({ scheduledAt: inMinutes(5) });
  return { variantId, slotId: res.body.slot.id as string };
}

export const makeDue = (slotId: string) =>
  prisma.slot.update({ where: { id: slotId }, data: { scheduledAt: new Date(Date.now() - 1000) } });

/** Simulate a worker that died right after claiming: 'publishing', old claimedAt, open attempt. */
export async function makeStale(slotId: string, ageMs = 10 * 60_000) {
  await prisma.slot.update({
    where: { id: slotId },
    data: { status: 'publishing', claimedAt: new Date(Date.now() - ageMs) },
  });
  await prisma.publishAttempt.create({ data: { slotId } });
}