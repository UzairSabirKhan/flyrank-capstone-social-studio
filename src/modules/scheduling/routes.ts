import { Router } from 'express';
import { z } from 'zod';
import { parseOrThrow } from '../../lib/validate';
import { cancelSlot, getSlot, resolveSlot } from './service';

const resolveSchema = z.object({
  outcome: z.enum(['posted', 'not_posted']),
  externalUrl: z.string().url().max(2048).optional(),
});

export const slotsRouter = Router();

slotsRouter.get('/:id', async (req, res) => {
  res.json({ slot: await getSlot(req.params.id) });
});

slotsRouter.delete('/:id', async (req, res) => {
  await cancelSlot(req.params.id);
  res.json({ cancelled: true });
});

slotsRouter.post('/:id/resolve', async (req, res) => {
  const { outcome, externalUrl } = parseOrThrow(resolveSchema, req.body);
  res.json({ slot: await resolveSlot(req.params.id, outcome, externalUrl) });
});
