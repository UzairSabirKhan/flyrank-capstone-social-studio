import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import type { SocialPublisher } from './adapters/SocialPublisher';
import { MockXPublisher } from './adapters/mock';
import { HttpError } from './lib/errors';
import { logger } from './lib/logger';
import { historyRouter } from './modules/history/routes';
import { mockPostsRouter } from './modules/history/mockPosts';
import { postsRouter } from './modules/posts/routes';
import { createPublishRouter } from './modules/scheduling/publishRoutes';
import { slotsRouter } from './modules/scheduling/routes';
import { createVariantsRouter } from './modules/variants/routes';

export interface AppDeps {
  publisher: SocialPublisher;
  /** Defaults to true outside production. */
  enableManualPublish?: boolean;
}

export function createApp(deps: AppDeps = { publisher: new MockXPublisher() }) {
  const manualPublish = deps.enableManualPublish ?? process.env.NODE_ENV !== 'production';

  const app = express();
  app.use(helmet());
  app.use(express.json({ limit: '200kb' }));
  app.use(rateLimit({ windowMs: 60_000, limit: 120 }));

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use('/posts', postsRouter);
  app.use('/variants', createVariantsRouter({ maxLength: deps.publisher.maxLength }));
  app.use('/slots', slotsRouter);
  if (manualPublish) app.use('/slots', createPublishRouter(deps.publisher));
  app.use('/history', historyRouter);
  app.use('/mock-posts', mockPostsRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res
        .status(err.status)
        .json({ error: { code: err.code, message: err.message, details: err.details } });
      return;
    }
    const status = (err as { status?: number }).status;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      res.status(status).json({ error: { code: 'BAD_REQUEST', message: 'Malformed request' } });
      return;
    }
    logger.error({ err }, 'Unhandled error');
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
  });

  return app;
}
