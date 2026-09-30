import { Prisma } from '@prisma/client';
import {
  PublishError,
  type PublishResult,
  type SocialPublisher,
} from '../../adapters/SocialPublisher';
import { prisma } from '../../lib/db';
import { HttpError } from '../../lib/errors';
import { logger } from '../../lib/logger';

export type Outcome = 'published' | 'noop' | 'skipped' | 'failed' | 'retry_scheduled';
export interface PublishOutcome {
  outcome: Outcome;
}
export interface PublishOptions {
  /** The worker sets this. The manual dev endpoint does not. */
  requireDue?: boolean;
}

export const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [30_000, 120_000]; // wait after attempt 1, then after attempt 2

export interface Claimed {
  slotId: string;
  variantId: string;
  idempotencyKey: string;
  text: string;
  attemptId: string;
}

/**
 * STEP 1: the atomic claim. One statement flips scheduled -> publishing, only if the variant
 * is still approved (and, for the worker, only if the slot is due). Postgres row locking means
 * exactly one concurrent caller gets a row back.
 */
async function claim(slotId: string, requireDue: boolean): Promise<Claimed | null> {
  const dueClause = requireDue
    ? Prisma.sql`AND s."scheduledAt" <= (now() AT TIME ZONE 'UTC')`
    : Prisma.empty;
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Omit<Claimed, 'attemptId'>[]>`
      UPDATE "Slot" AS s
      SET "status" = 'publishing',
          "claimedAt" = (now() AT TIME ZONE 'UTC'),
          "updatedAt" = (now() AT TIME ZONE 'UTC')
      FROM "Variant" AS v
      WHERE s."id" = ${slotId}
        AND s."status" = 'scheduled'
        ${dueClause}
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

  // Still 'scheduled' and approved-or-not: an unapproved variant's slot can never publish.
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
  // not due yet / publishing / published / failed: nothing to do.
  return { outcome: 'noop' };
}

/**
 * The retry policy. Retry only when we KNOW a retry cannot double-post:
 *  - 'rejected' + retryable: the platform did not post.
 *  - 'unknown' but the adapter dedupes by key: the same key returns the same post.
 * Everything else ends in 'failed'. An 'unknown' attempt then blocks rescheduling until resolved.
 */
export async function settleFailure(
  c: Claimed,
  err: unknown,
  publisher: SocialPublisher,
): Promise<Outcome> {
  const known = err instanceof PublishError;
  if (!known) logger.error({ err, slotId: c.slotId }, 'Publisher threw an unexpected error');
  const kind = known ? err.kind : 'unknown'; // an unexpected error might have posted
  const retryable = known ? err.retryable : false;
  const message = known ? err.message : 'Unexpected publisher error';
  const safeToRetry = kind === 'rejected' ? retryable : publisher.dedupesByKey;

  return prisma.$transaction(async (tx): Promise<Outcome> => {
    const attempts = await tx.publishAttempt.count({ where: { slotId: c.slotId } });
    const willRetry = safeToRetry && attempts < MAX_ATTEMPTS;

    await tx.publishAttempt.update({
      where: { id: c.attemptId },
      data: {
        result: kind === 'unknown' ? 'unknown' : 'failed',
        finishedAt: new Date(),
        error: willRetry ? `${message} (will retry)` : message,
      },
    });

    if (willRetry) {
      const delay = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]!;
      await tx.slot.update({
        where: { id: c.slotId },
        data: { status: 'scheduled', claimedAt: null, scheduledAt: new Date(Date.now() + delay) },
      });
      return 'retry_scheduled';
    }
    await tx.slot.update({ where: { id: c.slotId }, data: { status: 'failed' } });
    return 'failed';
  });
}

/** The post exists now, so a failure here must never trigger a resend. */
export async function finishPublished(c: Claimed, result: PublishResult): Promise<void> {
  try {
    await prisma.$transaction([
      prisma.publishAttempt.update({
        where: { id: c.attemptId },
        data: {
          result: 'published',
          finishedAt: new Date(),
          externalId: result.externalId,
          externalUrl: result.url,
        },
      }),
      prisma.slot.update({ where: { id: c.slotId }, data: { status: 'published' } }),
      prisma.variant.update({ where: { id: c.variantId }, data: { status: 'published' } }),
    ]);
  } catch (err) {
    // The slot stays 'publishing'. The recovery sweep handles it without blindly resending.
    logger.error(
      { err, slotId: c.slotId, externalId: result.externalId },
      'Post was sent but could not be recorded',
    );
    throw err;
  }
}

export async function publishSlot(
  slotId: string,
  publisher: SocialPublisher,
  options: PublishOptions = {},
): Promise<PublishOutcome> {
  const claimed = await claim(slotId, options.requireDue ?? false);
  if (!claimed) return explainNoClaim(slotId);

  // STEP 2: send. Only the claim winner ever reaches this line.
  let result: PublishResult;
  try {
    result = await publisher.publish({
      text: claimed.text,
      idempotencyKey: claimed.idempotencyKey,
    });
  } catch (err) {
    return { outcome: await settleFailure(claimed, err, publisher) };
  }

  // STEP 3: record.
  await finishPublished(claimed, result);
  return { outcome: 'published' };
}
