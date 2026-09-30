import { Router } from 'express';
import type { SocialPublisher } from '../../adapters/SocialPublisher';
import { publishSlot } from './publish';
import { getSlot } from './service';

export function createPublishRouter(publisher: SocialPublisher) {
  const router = Router();

  router.post('/:id/publish', async (req, res) => {
    const result = await publishSlot(req.params.id, publisher);
    const slot = await getSlot(req.params.id);
    const status =
      result.outcome === 'skipped'
        ? 409
        : result.outcome === 'failed'
          ? 502
          : result.outcome === 'retry_scheduled'
            ? 202
            : 200;
    res.status(status).json({ outcome: result.outcome, slot });
  });

  return router;
}
