import type { Config } from '../config';
import { DiscordPublisher } from './discord';
import { MockLinkedInPublisher, MockXPublisher } from './mock';
import { SlowPublisher } from './slow';
import type { SocialPublisher } from './SocialPublisher';

type PublisherConfig = Pick<Config, 'PUBLISHER'> &
  Partial<Pick<Config, 'DISCORD_WEBHOOK_URL' | 'DISCORD_GUILD_ID' | 'PUBLISH_DELAY_MS'>>;

function build(config: PublisherConfig): SocialPublisher {
  switch (config.PUBLISHER) {
    case 'discord':
      if (!config.DISCORD_WEBHOOK_URL) throw new Error('DISCORD_WEBHOOK_URL is required');
      return new DiscordPublisher(config.DISCORD_WEBHOOK_URL, config.DISCORD_GUILD_ID);
    case 'mock_x':
      return new MockXPublisher();
    case 'mock_linkedin':
      return new MockLinkedInPublisher();
  }
}

export function createPublisher(config: PublisherConfig): SocialPublisher {
  const publisher = build(config);
  const delay = config.PUBLISH_DELAY_MS ?? 0;
  return delay > 0 ? new SlowPublisher(publisher, delay) : publisher;
}
