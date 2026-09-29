import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/db';
import { createVariant, inMinutes, resetDb } from './helpers';

const app = createApp();

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe('review workflow', () => {
  it('approves a draft variant', async () => {
    const id = await createVariant(app);
    const res = await request(app).post(`/variants/${id}/approve`);
    expect(res.status).toBe(200);
    expect(res.body.variant.status).toBe('approved');
  });

  it('refuses to approve twice', async () => {
    const id = await createVariant(app, { approve: true });
    const res = await request(app).post(`/variants/${id}/approve`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('rejects a draft, and a rejected variant cannot be approved', async () => {
    const id = await createVariant(app);
    expect((await request(app).post(`/variants/${id}/reject`)).body.variant.status).toBe(
      'rejected',
    );
    expect((await request(app).post(`/variants/${id}/approve`)).status).toBe(409);
  });

  it('blocks an edit that breaks the profile and leaves the text unchanged', async () => {
    const id = await createVariant(app);
    const before = (await prisma.variant.findUniqueOrThrow({ where: { id } })).text;
    const res = await request(app)
      .patch(`/variants/${id}`)
      .send({ text: 'a'.repeat(300) });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VARIANT_RULE_VIOLATION');
    expect((await prisma.variant.findUniqueOrThrow({ where: { id } })).text).toBe(before);
  });

  it('sends an edited approved variant back to draft', async () => {
    const id = await createVariant(app, { approve: true });
    const res = await request(app)
      .patch(`/variants/${id}`)
      .send({ text: 'A fresh, valid post about testing. #Testing' });
    expect(res.status).toBe(200);
    expect(res.body.variant.status).toBe('draft');
    expect(res.body.variant.text).toBe('A fresh, valid post about testing. #Testing');
  });
});

describe('scheduling guard', () => {
  it('refuses to schedule a draft variant with 409 and creates no slot', async () => {
    const id = await createVariant(app);
    const res = await request(app)
      .post(`/variants/${id}/schedule`)
      .send({ scheduledAt: inMinutes(5) });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('VARIANT_NOT_APPROVED');
    expect(await prisma.slot.count()).toBe(0);
  });

  it('refuses to schedule a rejected variant', async () => {
    const id = await createVariant(app);
    await request(app).post(`/variants/${id}/reject`);
    const res = await request(app)
      .post(`/variants/${id}/schedule`)
      .send({ scheduledAt: inMinutes(5) });
    expect(res.status).toBe(409);
  });

  it('schedules an approved variant', async () => {
    const id = await createVariant(app, { approve: true });
    const res = await request(app)
      .post(`/variants/${id}/schedule`)
      .send({ scheduledAt: inMinutes(5) });
    expect(res.status).toBe(201);
    expect(res.body.slot.status).toBe('scheduled');
    expect(res.body.slot.idempotencyKey.startsWith(id)).toBe(true);
  });

  it('treats a repeated identical request as a replay, not a second slot', async () => {
    const id = await createVariant(app, { approve: true });
    const when = inMinutes(5);
    const a = await request(app).post(`/variants/${id}/schedule`).send({ scheduledAt: when });
    const b = await request(app).post(`/variants/${id}/schedule`).send({ scheduledAt: when });
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body.slot.id).toBe(a.body.slot.id);
    expect(await prisma.slot.count()).toBe(1);
  });

  it('creates exactly one slot when 5 identical requests race', async () => {
    const id = await createVariant(app, { approve: true });
    const when = inMinutes(5);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app).post(`/variants/${id}/schedule`).send({ scheduledAt: when }),
      ),
    );
    expect(results.every((r) => r.status === 200 || r.status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.body.slot.id)).size).toBe(1);
    expect(await prisma.slot.count()).toBe(1);
  });

  it('refuses a second slot at a different time', async () => {
    const id = await createVariant(app, { approve: true });
    await request(app)
      .post(`/variants/${id}/schedule`)
      .send({ scheduledAt: inMinutes(5) });
    const res = await request(app)
      .post(`/variants/${id}/schedule`)
      .send({ scheduledAt: inMinutes(9) });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_SCHEDULED');
  });

  it('refuses a time in the past and a malformed body', async () => {
    const id = await createVariant(app, { approve: true });
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(
      (await request(app).post(`/variants/${id}/schedule`).send({ scheduledAt: past })).status,
    ).toBe(400);
    expect(
      (await request(app).post(`/variants/${id}/schedule`).send({ scheduledAt: 'soon' })).status,
    ).toBe(400);
  });

  it('blocks edit and reject while a slot is open, and allows them after cancelling', async () => {
    const id = await createVariant(app, { approve: true });
    const s = await request(app)
      .post(`/variants/${id}/schedule`)
      .send({ scheduledAt: inMinutes(5) });
    const slotId = s.body.slot.id as string;
    const text = 'Another valid post for the test. #Testing';

    const edit = await request(app).patch(`/variants/${id}`).send({ text });
    expect(edit.status).toBe(409);
    expect(edit.body.error.code).toBe('VARIANT_SCHEDULED');
    expect((await request(app).post(`/variants/${id}/reject`)).status).toBe(409);

    expect((await request(app).delete(`/slots/${slotId}`)).status).toBe(200);
    expect((await request(app).patch(`/variants/${id}`).send({ text })).status).toBe(200);
  });
});
