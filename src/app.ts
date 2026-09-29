import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(express.json({ limit: '200kb' }));
  app.use(rateLimit({ windowMs: 60_000, limit: 120 }));

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  return app;
}
