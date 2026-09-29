import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiscordPublisher } from '../src/adapters/discord';
import { MockXPublisher } from '../src/adapters/mock';
import { createPublisher } from '../src/adapters/registry';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/db';
import { publishSlot } from '../src/modules/scheduling/publish';
import { createSlot, resetDb } from './helpers';

const app = createApp();
const WEBHOOK = 'https://discord.com/api/webhooks/123/super-secret-token';
const discord = new DiscordPublisher(WEBHOOK, '999');
const input = { text: 'hello world', idempotencyKey: 'k1' };
const reply = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(resetDb);
afterEach(() => vi.unstubAllGlobals());
afterAll(() => prisma.$disconnect());

describe('adapter swap', () => {
  it.each(['mock_x', 'mock_linkedin'] as const)(
    'publishes the same campaign through %s by configuration alone',
    async (name) => {
      const { slotId } = await createSlot(app);
      const result = await publishSlot(slotId, createPublisher({ PUBLISHER: name }));
      expect(result.outcome).toBe('published');
      const posts = await prisma.mockPost.findMany();
      expect(posts).toHaveLength(1);
      expect(posts[0]?.platform).toBe(name);
      expect(posts[0]?.preview).toContain('would post');
    },
  );

  it('builds the discord adapter from config, and refuses without a webhook', () => {
    expect(createPublisher({ PUBLISHER: 'discord', DISCORD_WEBHOOK_URL: WEBHOOK }).name).toBe(
      'discord',
    );
    expect(() => createPublisher({ PUBLISHER: 'discord' })).toThrow();
  });
});

describe('mock adapter', () => {
  it('creates one post per idempotency key, however often it is called', async () => {
    const mock = new MockXPublisher();
    const a = await mock.publish(input);
    const b = await mock.publish(input);
    expect(b.externalId).toBe(a.externalId);
    expect(await prisma.mockPost.count()).toBe(1);
    await mock.publish({ ...input, idempotencyKey: 'k2' });
    expect(await prisma.mockPost.count()).toBe(2);
  });
});

describe('discord adapter (fetch mocked, no network)', () => {
  it('posts with wait=true, suppresses mentions, and returns the message link', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(200, { id: '555', channel_id: '777' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await discord.publish({ ...input, text: 'hi @everyone' });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('wait=true');
    expect(JSON.parse(init.body)).toEqual({
      content: 'hi @everyone',
      allowed_mentions: { parse: [] },
    });
    expect(result).toEqual({ externalId: '555', url: 'https://discord.com/channels/999/777/555' });
  });

  it.each([
    [429, 'rejected'],
    [400, 'rejected'],
    [404, 'rejected'],
    [500, 'unknown'],
    [503, 'unknown'],
  ])('maps HTTP %i to kind %s', async (status, kind) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(status)));
    await expect(discord.publish(input)).rejects.toMatchObject({ kind });
  });

  it('treats a network failure as unknown and never leaks the webhook token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(`boom ${WEBHOOK}`)));
    const err = await discord.publish(input).catch((e: Error) => e);
    expect(err).toMatchObject({ kind: 'unknown' });
    expect((err as Error).message).not.toContain('super-secret-token');
  });

  it('refuses over-long text without calling Discord', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(discord.publish({ ...input, text: 'a'.repeat(2001) })).rejects.toMatchObject({
      kind: 'rejected',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
