# Social Media Studio: Design

## 1. Problem
Turn one blog post into one variant per social platform. A human approves each
variant, and a scheduler publishes each approved variant exactly once, even
under retries and worker crashes.

## 2. Non-goals
- No real X, LinkedIn, or Instagram publishing (mock adapters only).
- No images, analytics, or engagement tracking.
- No AI generation in the core (templates only).
- No user accounts or auth (single-operator tool).

## 3. Data model
| Table | Key fields | Notes |
|---|---|---|
| Post | id, sourceType (url/markdown), sourceUrl, title, bodyMarkdown, createdAt | Source of truth. Generation reads only this. |
| Variant | id, postId, platform, text, status (draft/approved/rejected/published), createdAt, updatedAt | Unique (postId, platform). Text is always validated before insert. |
| Slot | id, variantId, scheduledAt, status (scheduled/publishing/published/failed), idempotencyKey UNIQUE, claimedAt | One scheduled publication. |
| PublishAttempt | id, slotId, startedAt, finishedAt, result, externalId, externalUrl, error | Append-only history. |
| MockPost | id, platform, text, preview, createdAt | What mock adapters would post. |

## 4. Variant status flow
draft -> approved -> published
draft -> rejected\
Only `approved` variants can be scheduled. An edit re-validates the text and sends the variant back to `draft`.

## 5. API surface
Phase 2: POST /posts, GET /posts/:id, POST /posts/:id/variants (manual create),
POST /posts/:id/variants/generate, GET /posts/:id/variants
Phase 3: POST /variants/:id/approve, /reject, PATCH /variants/:id
Phase 4-5: POST /variants/:id/schedule, GET /history, GET /mock-posts
Errors always look like `{ "error": { "code", "message", "details?" } }`.

## 6. Constraint profiles (enforced in code)
| Rule | X-style | LinkedIn-style |
|---|---|---|
| Length (graphemes) | 10-280 | 80-2000 |
| Hashtags | 0-2 | 3-5 |
| Tone: exclamation marks | max 1 | max 1 |
| Tone: emoji | max 3 | max 2 |
| Tone: banned phrases | clickbait list | clickbait list |

## 7. Publisher interface
```ts
interface SocialPublisher {
  readonly name: string;
  publish(input: { text: string; idempotencyKey: string }):
    Promise<{ externalId: string; url: string | null }>;
}
```
The business logic depends on this interface only. The adapter is chosen by
the `PUBLISHER` env var through a registry.

## 8. Idempotency and durability plan
- Idempotency key derived from variant + slot, with a UNIQUE constraint in Postgres.
- Worker claims a slot with one atomic `UPDATE ... WHERE status='scheduled' RETURNING`.
- Queue: pg-boss (jobs live in the same Postgres). A reconciler re-enqueues due or stuck slots.
- Attempt states: pending -> publishing -> published | failed.

## 9. Decisions and known risks
- pg-boss over BullMQ: one fewer container, durable by default.
- Discord has no native idempotency key. A crash after send but before
  recording could duplicate. Mitigation: claim before send, record message ID
  immediately, and document the residual risk in the README.
- Prisma 6, with raw SQL for the atomic claim.
- SSRF protection on URL ingestion. DNS rebinding is a documented residual risk.