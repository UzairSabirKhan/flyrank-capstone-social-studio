import type { SocialPublisher } from '../../adapters/SocialPublisher';
import { prisma } from '../../lib/db';
import { finishPublished, settleFailure, type Claimed } from './publish';

export type RecoveryResult =
  'recovered' | 'needs_review' | 'skipped' | 'failed' | 'retry_scheduled';

/**
 * A slot stuck in 'publishing' means a worker died between the claim and the record.
 * From the database alone we cannot tell whether the post was sent.
 *  - Adapter dedupes by key: publish again. The same key returns the same post. Then record it.
 *  - Adapter cannot dedupe: DO NOT resend. Flag it 'unknown' for a human.
 */
export async function recoverStaleSlot(
  slotId: string,
  publisher: SocialPublisher,
  staleAfterMs: number,
): Promise<RecoveryResult> {
  const cutoff = new Date(Date.now() - staleAfterMs);

  // Take ownership: bump claimedAt so only one recoverer can pass this check.
  const { count } = await prisma.slot.updateMany({
    where: { id: slotId, status: 'publishing', claimedAt: { lt: cutoff } },
    data: { claimedAt: new Date() },
  });
  if (count !== 1) return 'skipped';

  const slot = await prisma.slot.findUniqueOrThrow({
    where: { id: slotId },
    include: {
      variant: { select: { id: true, text: true } },
      attempts: { where: { result: 'started' }, orderBy: { startedAt: 'desc' }, take: 1 },
    },
  });
  const open = slot.attempts[0] ?? (await prisma.publishAttempt.create({ data: { slotId } }));

  if (!publisher.dedupesByKey) {
    await prisma.$transaction([
      prisma.publishAttempt.update({
        where: { id: open.id },
        data: {
          result: 'unknown',
          finishedAt: new Date(),
          error:
            'Worker stopped mid-publish. The post may or may not exist. ' +
            'Check the target, then resolve it with POST /slots/:id/resolve.',
        },
      }),
      prisma.slot.update({ where: { id: slotId }, data: { status: 'failed' } }),
    ]);
    return 'needs_review';
  }

  const claimed: Claimed = {
    slotId,
    variantId: slot.variant.id,
    idempotencyKey: slot.idempotencyKey,
    text: slot.variant.text,
    attemptId: open.id,
  };
  try {
    const result = await publisher.publish({
      text: claimed.text,
      idempotencyKey: claimed.idempotencyKey,
    });
    await finishPublished(claimed, result);
    return 'recovered';
  } catch (err) {
    return settleFailure(claimed, err, publisher) as Promise<'failed' | 'retry_scheduled'>;
  }
}
