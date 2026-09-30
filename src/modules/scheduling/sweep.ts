import type { SocialPublisher } from '../../adapters/SocialPublisher';
import { prisma } from '../../lib/db';
import { recoverStaleSlot, type RecoveryResult } from './recover';

export interface SweepDeps {
  publisher: SocialPublisher;
  staleAfterMs: number;
  enqueue: (slotId: string) => Promise<void>;
}

export async function sweep({ publisher, staleAfterMs, enqueue }: SweepDeps) {
  const due = await prisma.slot.findMany({
    where: { status: 'scheduled', scheduledAt: { lte: new Date() } },
    orderBy: { scheduledAt: 'asc' },
    take: 100,
    select: { id: true },
  });
  for (const { id } of due) await enqueue(id);

  const stale = await prisma.slot.findMany({
    where: { status: 'publishing', claimedAt: { lt: new Date(Date.now() - staleAfterMs) } },
    orderBy: { claimedAt: 'asc' },
    take: 100,
    select: { id: true },
  });
  const recovery: RecoveryResult[] = [];
  for (const { id } of stale) recovery.push(await recoverStaleSlot(id, publisher, staleAfterMs));

  return { enqueued: due.length, staleFound: stale.length, recovery };
}
