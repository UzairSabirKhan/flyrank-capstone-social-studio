import { randomUUID } from 'node:crypto';
import type { SlotStatus } from '@prisma/client';
import { prisma } from '../../lib/db';
import { HttpError } from '../../lib/errors';
import { isUniqueViolation } from '../../lib/prismaErrors';

export const OPEN_SLOT_STATUSES: SlotStatus[] = ['scheduled', 'publishing'];

export async function scheduleVariant(variantId: string, scheduledAt: Date) {
  const variant = await prisma.variant.findUnique({ where: { id: variantId } });
  if (!variant) throw new HttpError(404, 'VARIANT_NOT_FOUND', 'Variant not found');

  // THE GUARD: nothing unapproved can ever be scheduled.
  if (variant.status !== 'approved') {
    throw new HttpError(
      409,
      'VARIANT_NOT_APPROVED',
      `Only approved variants can be scheduled (this one is ${variant.status})`,
    );
  }
  if (scheduledAt.getTime() <= Date.now()) {
    throw new HttpError(400, 'SCHEDULE_IN_PAST', 'scheduledAt must be in the future');
  }

  const id = randomUUID();
  try {
    const slot = await prisma.slot.create({
      data: { id, variantId, scheduledAt, idempotencyKey: `${variantId}:${id}` },
    });
    return { slot, replayed: false };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // The partial unique index fired: this variant already has an open slot.
    const existing = await prisma.slot.findFirst({
      where: { variantId, status: { in: OPEN_SLOT_STATUSES } },
    });
    if (existing && existing.scheduledAt.getTime() === scheduledAt.getTime()) {
      return { slot: existing, replayed: true }; // a client retry: same answer, no second slot
    }
    throw new HttpError(409, 'ALREADY_SCHEDULED', 'This variant already has an open slot', {
      slotId: existing?.id,
    });
  }
}

export async function cancelSlot(id: string) {
  const { count } = await prisma.slot.deleteMany({ where: { id, status: 'scheduled' } });
  if (count === 1) return;
  const slot = await prisma.slot.findUnique({ where: { id }, select: { status: true } });
  if (!slot) throw new HttpError(404, 'SLOT_NOT_FOUND', 'Slot not found');
  throw new HttpError(409, 'SLOT_NOT_CANCELLABLE', `Slot is ${slot.status}`);
}

export async function getSlot(id: string) {
  const slot = await prisma.slot.findUnique({
    where: { id },
    include: {
      attempts: { orderBy: { startedAt: 'asc' } },
      variant: { select: { id: true, platform: true, status: true } },
    },
  });
  if (!slot) throw new HttpError(404, 'SLOT_NOT_FOUND', 'Slot not found');
  return slot;
}
