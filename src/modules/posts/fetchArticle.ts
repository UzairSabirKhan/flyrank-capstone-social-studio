import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { assertPublicUrl } from '../../lib/ssrf';

export class FetchError extends Error {}
export class ExtractError extends Error {}

const MAX_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new FetchError('Page is too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function fetchHtml(rawUrl: string): Promise<{ html: string; finalUrl: string }> {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertPublicUrl(current); // re-checked on every redirect hop
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
        headers: { 'user-agent': 'SocialStudioBot/1.0', accept: 'text/html' },
      });
    } catch {
      throw new FetchError('Could not fetch the URL');
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new FetchError('Redirect without a location');
      current = new URL(location, url).toString();
      continue;
    }
    if (!res.ok) throw new FetchError(`The site returned status ${res.status}`);
    if (!(res.headers.get('content-type') ?? '').includes('text/html')) {
      throw new FetchError('The URL is not an HTML page');
    }
    return { html: await readCapped(res), finalUrl: url.toString() };
  }
  throw new FetchError('Too many redirects');
}

export function htmlToPost(html: string, url: string): { title: string; bodyMarkdown: string } {
  const dom = new JSDOM(html, { url }); // scripts are not executed by default
  const article = new Readability(dom.window.document).parse();
  if (!article?.content) throw new ExtractError('Could not find article content on that page');
  const bodyMarkdown = new TurndownService({ headingStyle: 'atx' }).turndown(article.content);
  return { title: article.title?.trim() || url, bodyMarkdown };
}
