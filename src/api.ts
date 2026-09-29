import { createApp } from './app';
import { loadConfig } from './config';
import { logger } from './lib/logger';

const config = loadConfig();
const app = createApp();

app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, 'API listening');
});
