import type { Config } from '../config';
import { DiscordPublisher } from './discord';
import { MockLinkedInPublisher, MockXPublisher } from './mock';
import type { SocialPublisher } from './SocialPublisher';

export function createPublisher(
  config: Pick<Config, 'PUBLISHER' | 'DISCORD_WEBHOOK_URL' | 'DISCORD_GUILD_ID'>,
): SocialPublisher {
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
