import { prisma } from '../../lib/db';
import { HttpError } from '../../lib/errors';
import { UnsafeUrlError } from '../../lib/ssrf';
import { ExtractError, FetchError, fetchHtml, htmlToPost } from './fetchArticle';

export type CreatePostInput =
  { sourceType: 'markdown'; title: string; markdown: string } | { sourceType: 'url'; url: string };

export async function createPost(input: CreatePostInput) {
  if (input.sourceType === 'markdown') {
    return prisma.post.create({
      data: { sourceType: 'markdown', title: input.title, bodyMarkdown: input.markdown },
    });
  }

  try {
    const { html, finalUrl } = await fetchHtml(input.url);
    const { title, bodyMarkdown } = htmlToPost(html, finalUrl);
    return await prisma.post.create({
      data: { sourceType: 'url', sourceUrl: finalUrl, title, bodyMarkdown },
    });
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw new HttpError(400, 'UNSAFE_URL', err.message);
    if (err instanceof FetchError) throw new HttpError(502, 'FETCH_FAILED', err.message);
    if (err instanceof ExtractError) throw new HttpError(422, 'EXTRACT_FAILED', err.message);
    throw err;
  }
}

export async function getPost(id: string) {
  const post = await prisma.post.findUnique({ where: { id }, include: { variants: true } });
  if (!post) throw new HttpError(404, 'POST_NOT_FOUND', 'Post not found');
  return post;
}
