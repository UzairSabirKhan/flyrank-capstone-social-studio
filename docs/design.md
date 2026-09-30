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

| Table          | Key fields                                                                                                   | Notes                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Post           | id, sourceType (url/markdown), sourceUrl, title, bodyMarkdown, createdAt                                     | Source of truth. Generation reads only this.                       |
| Variant        | id, postId, platform, text, status (draft/approved/rejected/published), createdAt, updatedAt                 | Unique (postId, platform). Text is always validated before insert. |
| Slot           | id, variantId, scheduledAt, status (scheduled/publishing/published/failed), idempotencyKey UNIQUE, claimedAt | One scheduled publication.                                         |
| PublishAttempt | id, slotId, startedAt, finishedAt, result, externalId, externalUrl, error                                    | Append-only history.                                               |
| MockPost       | id, platform, text, preview, createdAt                                                                       | What mock adapters would post.                                     |

## 4. Variant status flow

| Action           | Allowed from              | Result    | Notes                                           |
| ---------------- | ------------------------- | --------- | ----------------------------------------------- |
| approve          | draft                     | approved  | Text is re-validated against the profile first  |
| reject           | draft, approved           | rejected  | Blocked while the variant has an open slot      |
| edit (PATCH)     | draft, approved, rejected | draft     | Re-validates; blocked while an open slot exists |
| (worker) publish | approved                  | published | Phase 4-5                                       |

Only `approved` variants can be scheduled. Scheduling anything else returns 409.
An "open" slot is one in status scheduled or publishing. A variant can have at most
one open slot, enforced by a partial unique index in Postgres. Cancelling a
scheduled slot (DELETE /slots/:id) frees the variant for edit or reject.

## 5. API surface

Phase 2: POST /posts, GET /posts/:id, POST /posts/:id/variants (manual create),
POST /posts/:id/variants/generate, GET /posts/:id/variants
Phase 3: POST /variants/:id/approve, /reject, PATCH /variants/:id
Phase 4-5: POST /variants/:id/schedule, GET /history, GET /mock-posts
Errors always look like `{ "error": { "code", "message", "details?" } }`.

## 6. Constraint profiles (enforced in code)

| Rule                    | X-style        | LinkedIn-style |
| ----------------------- | -------------- | -------------- |
| Length (graphemes)      | 10-280         | 80-2000        |
| Hashtags                | 0-2            | 3-5            |
| Tone: exclamation marks | max 1          | max 1          |
| Tone: emoji             | max 3          | max 2          |
| Tone: banned phrases    | clickbait list | clickbait list |

## 7. Publisher interface

```ts
interface SocialPublisher {
  readonly name: string;
  publish(input: {
    text: string;
    idempotencyKey: string;
  }): Promise<{ externalId: string; url: string | null }>;
}
```

The business logic depends on this interface only. The adapter is chosen by
the `PUBLISHER` env var through a registry.

## 8. Idempotency and durability plan

- Idempotency key derived from variant + slot, with a UNIQUE constraint in Postgres.
- Worker claims a slot with one atomic `UPDATE ... WHERE status='scheduled' RETURNING`.
- pg-boss carries a per-minute cron sweep and per-slot jobs. The Slot table is the source of truth. Retries are DB-driven (max 3 attempts, 30s then 2min backoff). Stale publishing slots are recovered: re-published with the same key if the adapter dedupes, otherwise flagged unknown for a human.
- Attempt states: pending -> publishing -> published | failed.
- Two partial unique indexes: one open slot per variant, one published attempt per slot
- Unknown outcomes are never retried against adapters where dedupesByKey is false.

## 9. Decisions and known risks

- pg-boss over BullMQ: one fewer container, durable by default.
- Discord webhooks have no idempotency key; the atomic claim is the protection; residual risk is a crash between send and record.
- Prisma 6, with raw SQL for the atomic claim.
- SSRF protection on URL ingestion. DNS rebinding is a documented residual risk.
- Residual risk: for adapters without an idempotency key, a crash between send and record cannot be resolved automatically. It is detected, flagged, and never auto-resent.
