import { randomUUID } from 'node:crypto';
import type { SlotStatus } from '@prisma/client';
import { prisma } from '../../lib/db';
import { HttpError } from '../../lib/errors';
import { isUniqueViolation } from '../../lib/prismaErrors';

export const OPEN_SLOT_STATUSES: SlotStatus[] = ['scheduled', 'publishing'];

export interface ScheduleLimits {
  /** The configured publisher's own text limit, if it has one. */
  maxLength?: number;
}

export async function scheduleVariant(
  variantId: string,
  scheduledAt: Date,
  limits: ScheduleLimits = {},
) {
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
  if (limits.maxLength !== undefined && variant.text.length > limits.maxLength) {
    throw new HttpError(
      422,
      'TEXT_TOO_LONG_FOR_TARGET',
      `Text is ${variant.text.length} characters; the configured publisher allows ${limits.maxLength}`,
    );
  }
  // A failed slot with an 'unknown' attempt may have posted. Refuse until a human resolves it.
  const unresolved = await prisma.publishAttempt.findFirst({
    where: { result: 'unknown', slot: { variantId, status: 'failed' } },
    select: { slotId: true },
  });
  if (unresolved) {
    throw new HttpError(
      409,
      'OUTCOME_UNKNOWN',
      'A previous publish may have succeeded. Check the target, then resolve it with POST /slots/:id/resolve',
      { slotId: unresolved.slotId },
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
    const existing = await prisma.slot.findFirst({
      where: { variantId, status: { in: OPEN_SLOT_STATUSES } },
    });
    if (existing && existing.scheduledAt.getTime() === scheduledAt.getTime()) {
      return { slot: existing, replayed: true };
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

/** An operator settles a slot whose outcome was 'unknown' after checking the target by hand. */
export async function resolveSlot(
  slotId: string,
  outcome: 'posted' | 'not_posted',
  externalUrl?: string,
) {
  const slot = await prisma.slot.findUnique({
    where: { id: slotId },
    include: { attempts: { where: { result: 'unknown' }, orderBy: { startedAt: 'desc' } } },
  });
  if (!slot) throw new HttpError(404, 'SLOT_NOT_FOUND', 'Slot not found');
  const latest = slot.attempts[0];
  if (slot.status !== 'failed' || !latest) {
    throw new HttpError(
      409,
      'NOTHING_TO_RESOLVE',
      'Only a failed slot with an unknown outcome can be resolved',
    );
  }

  if (outcome === 'posted') {
    await prisma.$transaction([
      prisma.publishAttempt.update({
        where: { id: latest.id },
        data: {
          result: 'published',
          externalId: 'manual',
          externalUrl: externalUrl ?? null,
          error: 'Confirmed posted by an operator',
          finishedAt: new Date(),
        },
      }),
      prisma.publishAttempt.updateMany({
        where: { slotId, result: 'unknown' },
        data: { result: 'failed', error: 'Superseded by an operator resolution' },
      }),
      prisma.slot.update({ where: { id: slotId }, data: { status: 'published' } }),
      prisma.variant.update({ where: { id: slot.variantId }, data: { status: 'published' } }),
    ]);
  } else {
    await prisma.publishAttempt.updateMany({
      where: { slotId, result: 'unknown' },
      data: { result: 'failed', error: 'Confirmed NOT posted by an operator' },
    });
  }
  return getSlot(slotId);
}
