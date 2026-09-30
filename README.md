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

## Verify it (the six probes)

Start the stack first (see "Run it"). With the default `PUBLISHER=mock_x`, no external account is needed.

**Probes 1–4** (ingest and generate, blocked variant, refused schedule, scheduled publish):

```powershell
powershell -ExecutionPolicy Bypass -File requests\probes.ps1
```

This prints PASS or FAIL per probe. It waits up to 4 minutes for the worker, which sweeps once a
minute. Then open http://localhost:3000/history/view to see the attempt.

**Probe 5** (kill the worker mid-publish, restart, exactly one post):

```powershell
docker compose stop worker
docker compose exec api npx tsx scripts/prove-crash-safety.ts
docker compose start worker
```

It seeds 5 slots, hard-kills a worker after a post is sent but before it is recorded, restarts it,
and ends with `PASS: exactly one post per slot, zero duplicates`.

**Probe 6** (swap the adapter by configuration): change `PUBLISHER` in `.env` (for example
`mock_x` to `mock_linkedin`), run `docker compose up -d`, then run `probes.ps1` again. The post lands
in `/mock-posts` and `/history/view`. No code changes.

**Real Discord target (Probe 4 against the live service).** Create a webhook in your own server
(Channel settings, Integrations, Webhooks, Copy URL), turn on Developer Mode to copy the server ID,
then set these in `.env` and run `docker compose up -d`:

```
PUBLISHER=discord
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/<id>/<token>
DISCORD_GUILD_ID=<server id>
```

The history row then links to the live message.

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