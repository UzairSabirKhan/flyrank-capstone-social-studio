import type { Post } from '@prisma/client';
import { firstSentences, graphemeLength, truncateGraphemes } from '../../lib/text';
import type { Platform } from './profiles';

export type PostInput = Pick<Post, 'title' | 'bodyMarkdown' | 'sourceUrl'>;

const STOP = new Set([
  'about',
  'their',
  'there',
  'which',
  'would',
  'could',
  'should',
  'these',
  'those',
  'where',
  'while',
  'being',
  'other',
  'after',
  'before',
  'because',
  'really',
  'things',
  'using',
]);

export function hashtagsFrom(text: string, count: number, fallback: string[]): string[] {
  const freq = new Map<string, number>();
  for (const word of text.toLowerCase().match(/\p{L}{5,}/gu) ?? []) {
    if (!STOP.has(word)) freq.set(word, (freq.get(word) ?? 0) + 1);
  }
  const ranked = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w);
  const unique = [...new Set([...ranked, ...fallback.map((f) => f.toLowerCase())])];
  return unique.slice(0, count).map((w) => `#${w.charAt(0).toUpperCase()}${w.slice(1)}`);
}

const calm = (s: string) => s.replace(/!+/g, '.');

export function generateX(post: PostInput): string {
  const tags = hashtagsFrom(`${post.title} ${post.title} ${post.bodyMarkdown}`, 2, [
    'Tech',
    'Blog',
  ]);
  const tail = [post.sourceUrl, tags.join(' ')].filter(Boolean).join('\n');
  const summary = firstSentences(post.bodyMarkdown, 1);
  const hook = summary ? `${post.title}: ${summary}` : post.title;
  const budget = 280 - graphemeLength(tail) - 2; // 2 = blank line between hook and tail
  return calm(`${truncateGraphemes(hook, budget)}\n\n${tail}`);
}

export function generateLinkedIn(post: PostInput): string {
  const body = firstSentences(post.bodyMarkdown, 4);
  const cta = post.sourceUrl ? `Read the full post: ${post.sourceUrl}` : '';
  const tags = hashtagsFrom(`${post.title} ${post.title} ${post.bodyMarkdown}`, 4, [
    'Insights',
    'Learning',
    'Industry',
    'Business',
  ]).join(' ');
  return calm([post.title, body, cta, tags].filter(Boolean).join('\n\n'));
}

export const GENERATORS: Record<Platform, (post: PostInput) => string> = {
  x: generateX,
  linkedin: generateLinkedIn,
};
