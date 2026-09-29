import { Router } from 'express';
import { cancelSlot, getSlot } from './service';

export const slotsRouter = Router();

slotsRouter.get('/:id', async (req, res) => {
  res.json({ slot: await getSlot(req.params.id) });
});

slotsRouter.delete('/:id', async (req, res) => {
  await cancelSlot(req.params.id);
  res.json({ cancelled: true });
});
