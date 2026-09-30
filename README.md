# Social Media Studio

Turns one blog post into one variant per social platform. A person approves each variant.
A scheduler publishes each approved variant exactly once, even under retries and worker crashes.

## Architecture

```
blog post (URL or Markdown)
   -> ingest + store (SSRF-guarded)          <- single source of truth
   -> variant generator -> constraint validation (length, hashtags, tone)
   -> review: draft -> approved | rejected   <- only approved can be scheduled (409 otherwise)
   -> Slot (idempotency key, UNIQUE)         <- Postgres partial unique indexes
   -> worker: pg-boss cron sweep -> publish-slot jobs -> atomic claim
   -> SocialPublisher interface
        +-- Discord webhook (real)
        +-- MockX, MockLinkedIn (record what they would post)
   -> publish history (GET /history, /history/view)
```

## Run it

```
cp .env.example .env        # PowerShell: Copy-Item .env.example .env
docker compose up --build -d
docker compose exec api npx tsx scripts/seed.ts
```

Then open http://localhost:3000/history/view. Set `PUBLISHER=discord` (plus the webhook URL and
server ID) in `.env` to publish for real. `PUBLISHER=mock_x` or `mock_linkedin` uses the mocks.

## How duplicates are prevented

1. Claim: one atomic `UPDATE ... WHERE status='scheduled'`. Only one caller wins.
2. Database constraints: one open slot per variant, one `published` attempt per slot.
3. Mock adapters dedupe by idempotency key. Real webhooks cannot.
4. Failures are classified: `rejected` (definitely not posted) or `unknown` (might have posted).
5. A crashed worker leaves a stale `publishing` slot. Adapters that dedupe are re-run with the
   same key. Adapters that cannot dedupe are never re-sent: the slot is flagged `unknown` and a
   human resolves it with `POST /slots/:id/resolve`.

## Tests

`npm test` (needs Postgres; see CI). `npm run prove:crash` kills a live worker mid-publish and
checks for zero duplicates.

## Known limitations

- Discord has no idempotency key. A crash between send and record is detected and flagged for a
  human. It is never auto-resent.
- Cron has one-minute granularity, so a post publishes up to about a minute after its slot time.
- The app and database clocks are assumed to be in sync.
- `STALE_AFTER_SECONDS` must exceed the slowest publish.
- URL ingestion resolves DNS before fetching; a DNS-rebinding race is a residual risk.
- Single-operator tool: there is no authentication.