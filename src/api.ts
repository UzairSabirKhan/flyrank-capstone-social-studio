import { createPublisher } from './adapters/registry';
import { createApp } from './app';
import { loadConfig } from './config';
import { logger } from './lib/logger';

const config = loadConfig();
const publisher = createPublisher(config);
const app = createApp({ publisher });

app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, publisher: publisher.name }, 'API listening');
});
