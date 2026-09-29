import {
  PublishError,
  type PublishInput,
  type PublishResult,
  type SocialPublisher,
} from './SocialPublisher';

const MAX_LENGTH = 2000; // Discord's message limit; counted in UTF-16 units to stay conservative

export class DiscordPublisher implements SocialPublisher {
  readonly name = 'discord';
  readonly dedupesByKey = false; // webhooks have no idempotency key

  constructor(
    private readonly webhookUrl: string,
    private readonly guildId?: string,
  ) {}

  async publish({ text }: PublishInput): Promise<PublishResult> {
    if (text.length > MAX_LENGTH) {
      throw new PublishError(`Text is over Discord's ${MAX_LENGTH} character limit`, 'rejected');
    }

    const url = new URL(this.webhookUrl);
    url.searchParams.set('wait', 'true'); // makes Discord return the created message

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // allowed_mentions.parse = [] stops @everyone / @here from pinging anyone
        body: JSON.stringify({ content: text, allowed_mentions: { parse: [] } }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // Never include the caught error or the URL: the webhook token is a secret.
      throw new PublishError('Discord did not respond (timeout or network error)', 'unknown');
    }

    if (res.status === 429) throw new PublishError('Discord rate limit hit', 'rejected');
    if (res.status >= 400 && res.status < 500) {
      throw new PublishError(`Discord rejected the post (status ${res.status})`, 'rejected');
    }
    if (!res.ok) {
      throw new PublishError(`Discord server error (status ${res.status})`, 'unknown');
    }

    let data: { id?: string; channel_id?: string };
    try {
      data = (await res.json()) as { id?: string; channel_id?: string };
    } catch {
      throw new PublishError('Discord replied OK but the body was unreadable', 'unknown');
    }
    if (!data.id) throw new PublishError('Discord replied OK without a message id', 'unknown');

    const link =
      this.guildId && data.channel_id
        ? `https://discord.com/channels/${this.guildId}/${data.channel_id}/${data.id}`
        : null;
    return { externalId: data.id, url: link };
  }
}
