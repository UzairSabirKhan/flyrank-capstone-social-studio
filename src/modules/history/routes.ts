import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/db';
import { parseOrThrow } from '../../lib/validate';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  slotId: z.string().max(64).optional(),
});

async function getHistory(limit: number, slotId?: string) {
  const attempts = await prisma.publishAttempt.findMany({
    where: slotId ? { slotId } : {},
    orderBy: { startedAt: 'desc' },
    take: limit,
    include: {
      slot: {
        select: {
          status: true,
          scheduledAt: true,
          variant: { select: { id: true, platform: true } },
        },
      },
    },
  });
  return attempts.map((a) => ({
    attemptId: a.id,
    slotId: a.slotId,
    variantId: a.slot.variant.id,
    platform: a.slot.variant.platform,
    slotStatus: a.slot.status,
    scheduledAt: a.slot.scheduledAt,
    startedAt: a.startedAt,
    finishedAt: a.finishedAt,
    result: a.result,
    externalId: a.externalId,
    externalUrl: a.externalUrl,
    error: a.error,
  }));
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
const iso = (d: Date | null) => (d ? d.toISOString() : '');

export const historyRouter = Router();

historyRouter.get('/', async (req, res) => {
  const { limit, slotId } = parseOrThrow(querySchema, req.query);
  res.json({ history: await getHistory(limit, slotId) });
});

historyRouter.get('/view', async (_req, res) => {
  const history = await getHistory(50);
  const mockPosts = await prisma.mockPost.findMany({ orderBy: { createdAt: 'desc' }, take: 20 });

  const rows = history
    .map((h) => {
      const link = h.externalUrl?.startsWith('https://')
        ? `<a href="${esc(h.externalUrl)}" rel="noopener noreferrer">open</a>`
        : '';
      return `<tr><td>${esc(iso(h.startedAt))}</td><td>${esc(h.platform)}</td>
        <td>${esc(h.result)}</td><td>${esc(h.slotStatus)}</td><td>${link}</td>
        <td>${esc(h.error)}</td><td><code>${esc(h.slotId)}</code></td></tr>`;
    })
    .join('\n');

  const previews = mockPosts
    .map(
      (m) =>
        `<h3>${esc(m.platform)} &middot; ${esc(iso(m.createdAt))}</h3><pre>${esc(m.preview)}</pre>`,
    )
    .join('\n');

  res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Publish history</title>
<style>body{font-family:system-ui,sans-serif;margin:2rem}table{border-collapse:collapse}
td,th{border:1px solid #ccc;padding:.3rem .6rem;text-align:left;font-size:.9rem}
pre{background:#f4f4f4;padding:.8rem;white-space:pre-wrap}</style></head><body>
<h1>Publish history</h1>
<table><thead><tr><th>Started (UTC)</th><th>Platform</th><th>Result</th><th>Slot</th>
<th>Live message</th><th>Error</th><th>Slot id</th></tr></thead><tbody>${rows}</tbody></table>
<h2>Mock previews</h2>${previews || '<p>None yet.</p>'}
</body></html>`);
});
