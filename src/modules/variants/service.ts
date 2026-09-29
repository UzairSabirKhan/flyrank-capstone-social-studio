import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/db';
import { HttpError } from '../../lib/errors';
import { GENERATORS } from './generators';
import { PROFILES, type Platform } from './profiles';
import { validateVariant, type Violation } from './validator';

export async function createVariant(postId: string, platform: Platform, text: string) {
  const post = await prisma.post.findUnique({ where: { id: postId }, select: { id: true } });
  if (!post) throw new HttpError(404, 'POST_NOT_FOUND', 'Post not found');

  const violations = validateVariant(PROFILES[platform], text);
  if (violations.length > 0) {
    throw new HttpError(
      422,
      'VARIANT_RULE_VIOLATION',
      `Variant breaks ${platform} rules`,
      violations,
    );
  }

  try {
    return await prisma.variant.create({ data: { postId, platform, text } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new HttpError(
        409,
        'VARIANT_EXISTS',
        `A ${platform} variant already exists for this post`,
      );
    }
    throw err;
  }
}

export async function generateVariants(postId: string, platforms: Platform[]) {
  // Generation reads ONLY the stored post (the source of truth).
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) throw new HttpError(404, 'POST_NOT_FOUND', 'Post not found');

  const created = [];
  const blocked: { platform: Platform; violations: Violation[] }[] = [];

  for (const platform of platforms) {
    const text = GENERATORS[platform](post);
    try {
      created.push(await createVariant(postId, platform, text));
    } catch (err) {
      if (err instanceof HttpError && err.code === 'VARIANT_RULE_VIOLATION') {
        blocked.push({ platform, violations: err.details as Violation[] });
      } else {
        throw err;
      }
    }
  }
  return { created, blocked };
}

export function listVariants(postId: string) {
  return prisma.variant.findMany({ where: { postId }, orderBy: { createdAt: 'asc' } });
}
