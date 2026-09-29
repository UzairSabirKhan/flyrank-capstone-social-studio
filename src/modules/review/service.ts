import type { Prisma, VariantStatus } from '@prisma/client';
import { prisma } from '../../lib/db';
import { HttpError } from '../../lib/errors';
import { OPEN_SLOT_STATUSES } from '../scheduling/service';
import { PROFILES, isPlatform } from '../variants/profiles';
import { validateVariant } from '../variants/validator';

type Action = 'approve' | 'reject' | 'edit';

const RULES: Record<Action, { from: VariantStatus[]; to: VariantStatus; blockedBySlot: boolean }> =
  {
    approve: { from: ['draft'], to: 'approved', blockedBySlot: false },
    reject: { from: ['draft', 'approved'], to: 'rejected', blockedBySlot: true },
    edit: { from: ['draft', 'approved', 'rejected'], to: 'draft', blockedBySlot: true },
  };

export async function getVariant(id: string) {
  const variant = await prisma.variant.findUnique({ where: { id } });
  if (!variant) throw new HttpError(404, 'VARIANT_NOT_FOUND', 'Variant not found');
  return variant;
}

function assertValid(platform: string, text: string) {
  if (!isPlatform(platform)) {
    throw new HttpError(422, 'UNKNOWN_PLATFORM', `No constraint profile for ${platform}`);
  }
  const violations = validateVariant(PROFILES[platform], text);
  if (violations.length > 0) {
    throw new HttpError(
      422,
      'VARIANT_RULE_VIOLATION',
      `Variant breaks ${platform} rules`,
      violations,
    );
  }
}

async function transition(
  id: string,
  action: Action,
  data: Prisma.VariantUpdateManyMutationInput = {},
) {
  const rule = RULES[action];
  const variant = await getVariant(id);

  if (rule.blockedBySlot) {
    const open = await prisma.slot.findFirst({
      where: { variantId: id, status: { in: OPEN_SLOT_STATUSES } },
      select: { id: true },
    });
    if (open) {
      throw new HttpError(409, 'VARIANT_SCHEDULED', 'Cancel the scheduled slot first', {
        slotId: open.id,
      });
    }
  }

  // Conditional update: only succeeds if the status is still what we expect.
  const { count } = await prisma.variant.updateMany({
    where: { id, status: { in: rule.from } },
    data: { ...data, status: rule.to },
  });
  if (count === 0) {
    throw new HttpError(
      409,
      'INVALID_TRANSITION',
      `Cannot ${action} a variant that is ${variant.status}`,
    );
  }
  return prisma.variant.findUniqueOrThrow({ where: { id } });
}

export async function approveVariant(id: string) {
  const variant = await getVariant(id);
  assertValid(variant.platform, variant.text); // defence in depth: re-check at approval
  return transition(id, 'approve');
}

export function rejectVariant(id: string) {
  return transition(id, 'reject');
}

export async function editVariant(id: string, text: string) {
  const variant = await getVariant(id);
  assertValid(variant.platform, text);
  return transition(id, 'edit', { text });
}
