import { Router } from 'express';
import { z } from 'zod';
import { parseOrThrow } from '../../lib/validate';
import { approveVariant, editVariant, getVariant, rejectVariant } from '../review/service';
import { scheduleVariant } from '../scheduling/service';

const editSchema = z.object({ text: z.string().min(1).max(10_000) });
// ISO 8601 in UTC, e.g. 2026-10-01T09:30:00.000Z
const scheduleSchema = z.object({ scheduledAt: z.string().datetime() });

export const variantsRouter = Router();

variantsRouter.get('/:id', async (req, res) => {
  res.json({ variant: await getVariant(req.params.id) });
});

variantsRouter.patch('/:id', async (req, res) => {
  const { text } = parseOrThrow(editSchema, req.body);
  res.json({ variant: await editVariant(req.params.id, text) });
});

variantsRouter.post('/:id/approve', async (req, res) => {
  res.json({ variant: await approveVariant(req.params.id) });
});

variantsRouter.post('/:id/reject', async (req, res) => {
  res.json({ variant: await rejectVariant(req.params.id) });
});

variantsRouter.post('/:id/schedule', async (req, res) => {
  const { scheduledAt } = parseOrThrow(scheduleSchema, req.body);
  const { slot, replayed } = await scheduleVariant(req.params.id, new Date(scheduledAt));
  res.status(replayed ? 200 : 201).json({ slot, replayed });
});
