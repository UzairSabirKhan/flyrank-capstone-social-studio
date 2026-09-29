import pino from 'pino';

export const logger = pino({
  level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
  redact: {
    paths: ['*.TELEGRAM_BOT_TOKEN', '*.token', 'req.headers.authorization', 'DATABASE_URL'],
    censor: '[REDACTED]',
  },
});
