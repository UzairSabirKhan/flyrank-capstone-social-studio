import { Router } from 'express';
import { prisma } from '../../lib/db';

export const mockPostsRouter = Router();

mockPostsRouter.get('/', async (_req, res) => {
  const mockPosts = await prisma.mockPost.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
  res.json({ mockPosts });
});
