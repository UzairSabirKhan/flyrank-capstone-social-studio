import { Router } from 'express';
import { z } from 'zod';
import { parseOrThrow } from '../../lib/validate';
import { PLATFORMS } from '../variants/profiles';
import { createVariant, generateVariants, listVariants } from '../variants/service';
import { createPost, getPost } from './service';

const createPostSchema = z.discriminatedUnion('sourceType', [
  z.object({ sourceType: z.literal('url'), url: z.string().max(2048) }),
  z.object({
    sourceType: z.literal('markdown'),
    title: z.string().trim().min(1).max(200),
    markdown: z.string().trim().min(20).max(100_000),
  }),
]);

const generateSchema = z.object({
  platforms: z.array(z.enum(PLATFORMS)).min(1).optional(),
});

const manualVariantSchema = z.object({
  platform: z.enum(PLATFORMS),
  text: z.string().min(1).max(10_000),
});

export const postsRouter = Router();

postsRouter.post('/', async (req, res) => {
  const input = parseOrThrow(createPostSchema, req.body);
  const post = await createPost(input);
  res.status(201).json({ post });
});

postsRouter.get('/:id', async (req, res) => {
  res.json({ post: await getPost(req.params.id) });
});

postsRouter.get('/:id/variants', async (req, res) => {
  res.json({ variants: await listVariants(req.params.id) });
});

postsRouter.post('/:id/variants', async (req, res) => {
  const { platform, text } = parseOrThrow(manualVariantSchema, req.body);
  const variant = await createVariant(req.params.id, platform, text);
  res.status(201).json({ variant });
});

postsRouter.post('/:id/variants/generate', async (req, res) => {
  const { platforms } = parseOrThrow(generateSchema, req.body ?? {});
  const result = await generateVariants(req.params.id, platforms ?? [...PLATFORMS]);
  res.status(result.created.length > 0 ? 201 : 422).json(result);
});
