import {
  PublishError,
  type PublishResult,
  type SocialPublisher,
} from '../../adapters/SocialPublisher';
import { prisma } from '../../lib/db';
import { HttpError } from '../../lib/errors';
import { logger } from '../../lib/logger';

export interface PublishOutcome {
  outcome: 'published' | 'noop' | 'skipped' | 'failed';
}

interface Claimed {
  slotId: string;
  variantId: string;
  idempotencyKey: string;
  text: string;
  attemptId: string;
}

/**
 * STEP 1: the atomic claim. One statement flips scheduled -> publishing, and only if the
 * variant is still approved. Postgres row locking means exactly one concurrent caller
 * gets a row back. The attempt row is created in the same transaction.
 * (now() AT TIME ZONE 'UTC' matches how Prisma stores timestamps.)
 */
async function claim(slotId: string): Promise<Claimed | null> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Omit<Claimed, 'attemptId'>[]>`
      UPDATE "Slot" AS s
      SET "status" = 'publishing',
          "claimedAt" = (now() AT TIME ZONE 'UTC'),
          "updatedAt" = (now() AT TIME ZONE 'UTC')
      FROM "Variant" AS v
      WHERE s."id" = ${slotId}
        AND s."status" = 'scheduled'
        AND v."id" = s."variantId"
        AND v."status" = 'approved'
      RETURNING s."id" AS "slotId", s."variantId" AS "variantId",
                s."idempotencyKey" AS "idempotencyKey", v."text" AS "text"`;
    const row = rows[0];
    if (!row) return null;
    const attempt = await tx.publishAttempt.create({ data: { slotId } });
    return { ...row, attemptId: attempt.id };
  });
}

/** Nobody won the claim. Work out why, and never send anything. */
async function explainNoClaim(slotId: string): Promise<PublishOutcome> {
  const slot = await prisma.slot.findUnique({
    where: { id: slotId },
    include: { variant: { select: { status: true } } },
  });
  if (!slot) throw new HttpError(404, 'SLOT_NOT_FOUND', 'Slot not found');

  // Still 'scheduled' but unclaimable means the variant is no longer approved.
  if (slot.status === 'scheduled' && slot.variant.status !== 'approved') {
    const reason = `Variant is ${slot.variant.status}, not approved`;
    const failedNow = await prisma.$transaction(async (tx) => {
      const { count } = await tx.slot.updateMany({
        where: { id: slotId, status: 'scheduled' },
        data: { status: 'failed' },
      });
      if (count === 1) {
        await tx.publishAttempt.create({
          data: { slotId, result: 'failed', finishedAt: new Date(), error: reason },
        });
      }
      return count === 1;
    });
    if (failedNow) return { outcome: 'skipped' };
  }
  // publishing / published / failed: someone else owns it or it is finished.
  return { outcome: 'noop' };
}

async function recordFailure(c: Claimed, err: unknown) {
  const known = err instanceof PublishError;
  if (!known) logger.error({ err, slotId: c.slotId }, 'Publisher threw an unexpected error');
  const kind = known ? err.kind : 'unknown'; // an unexpected error might have posted: be conservative
  await prisma.$transaction([
    prisma.publishAttempt.update({
      where: { id: c.attemptId },
      data: {
        result: kind === 'unknown' ? 'unknown' : 'failed',
        finishedAt: new Date(),
        error: known ? err.message : 'Unexpected publisher error',
      },
    }),
    prisma.slot.update({ where: { id: c.slotId }, data: { status: 'failed' } }),
  ]);
}

export async function publishSlot(
  slotId: string,
  publisher: SocialPublisher,
): Promise<PublishOutcome> {
  const claimed = await claim(slotId);
  if (!claimed) return explainNoClaim(slotId);

  // STEP 2: send. Only the claim winner ever reaches this line.
  let result: PublishResult;
  try {
    result = await publisher.publish({
      text: claimed.text,
      idempotencyKey: claimed.idempotencyKey,
    });
  } catch (err) {
    await recordFailure(claimed, err);
    return { outcome: 'failed' };
  }

  // STEP 3: record. The post exists now, so a failure here must never trigger a resend.
  try {
    await prisma.$transaction([
      prisma.publishAttempt.update({
        where: { id: claimed.attemptId },
        data: {
          result: 'published',
          finishedAt: new Date(),
          externalId: result.externalId,
          externalUrl: result.url,
        },
      }),
      prisma.slot.update({ where: { id: claimed.slotId }, data: { status: 'published' } }),
      prisma.variant.update({ where: { id: claimed.variantId }, data: { status: 'published' } }),
    ]);
  } catch (err) {
    // Slot stays 'publishing'. The Phase 5 reconciler handles it without resending.
    logger.error(
      { err, slotId, externalId: result.externalId },
      'Post was sent but could not be recorded',
    );
    throw err;
  }
  return { outcome: 'published' };
}
