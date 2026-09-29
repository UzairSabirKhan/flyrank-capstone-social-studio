import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/db';

const app = createApp();

const markdown = `# Idempotency

Publishing systems retry on failure. A retry after a timeout must never create a second post.
Idempotency keys let the server recognise a repeated request and ignore it. This is why the
database, not the application code, should enforce uniqueness. Teams that skip this step end up
with duplicate posts and angry customers.`;

async function makePost(): Promise<string> {
  const res = await request(app)
    .post('/posts')
    .send({ sourceType: 'markdown', title: 'Why Idempotency Matters', markdown });
  return res.body.post.id as string;
}

beforeEach(async () => {
  await prisma.post.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST /posts', () => {
  it('stores a markdown post', async () => {
    const res = await request(app)
      .post('/posts')
      .send({ sourceType: 'markdown', title: 'Hello', markdown });
    expect(res.status).toBe(201);
    expect(res.body.post.bodyMarkdown).toBe(markdown.trim());
    expect(await prisma.post.count()).toBe(1);
  });

  it('rejects an invalid body with 400', async () => {
    const res = await request(app).post('/posts').send({ sourceType: 'markdown', title: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('refuses a URL that points at a private address', async () => {
    const res = await request(app)
      .post('/posts')
      .send({ sourceType: 'url', url: 'http://127.0.0.1:5432/' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNSAFE_URL');
    expect(await prisma.post.count()).toBe(0);
  });
});

describe('variant generation', () => {
  it('turns one stored post into two different, valid variants', async () => {
    const postId = await makePost();
    const res = await request(app).post(`/posts/${postId}/variants/generate`).send({});
    expect(res.status).toBe(201);
    expect(res.body.blocked).toEqual([]);
    expect(res.body.created).toHaveLength(2);
    const [a, b] = res.body.created;
    expect(a.text).not.toEqual(b.text);
    expect(a.status).toBe('draft');
  });

  it('returns 409 when variants already exist', async () => {
    const postId = await makePost();
    await request(app).post(`/posts/${postId}/variants/generate`).send({});
    const again = await request(app).post(`/posts/${postId}/variants/generate`).send({});
    expect(again.status).toBe(409);
  });
});

describe('constraint enforcement', () => {
  it('blocks a rule-breaking variant with a clear 422 and stores nothing', async () => {
    const postId = await makePost();
    const res = await request(app)
      .post(`/posts/${postId}/variants`)
      .send({ platform: 'x', text: 'a'.repeat(300) });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VARIANT_RULE_VIOLATION');
    expect(res.body.error.details.map((v: { code: string }) => v.code)).toContain('TOO_LONG');
    expect(await prisma.variant.count()).toBe(0);
  });
});
