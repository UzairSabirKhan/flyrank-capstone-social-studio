# Build log: AI usage

This log records where AI helped, where it was wrong,
what I changed, and how I verified each piece. I can explain every line of code in this repository.

**Tool used:** Claude (Anthropic), in the claude.ai chat. It acted as a planner, a pair programmer,
and a code reviewer. It had no access to my machine. I ran every command myself.
**Environment:** Windows, PowerShell, Docker Desktop (WSL2), Node.js 22.

---

## How I used AI, in general

1. **Planning.** Claude reviewed the capstone brief and my initial stack, and proposed the missing pieces.
2. **Code in small pieces.** Claude wrote each phase's code. I read it, ran it, and asked questions before committing.
3. **Review.** I uploaded a zip of the repository after Phase 4 and asked Claude to look for mistakes.
4. **Triage.** I pasted tool output (a failed command, a gitleaks finding) and asked what it meant.

## How I verified AI output

- Every phase: `npm run typecheck`, `npm run lint`, `npm test`, all green before a commit.
- Read the code, then ran it by hand with `curl.exe` and kept the transcripts as evidence.
- Inspected the database directly for anything the ORM cannot express (partial unique indexes).
- Proved the reliability claims with tests that fail if the protection is removed (10 parallel publishes, a crash-recovery script), not only by reading the code.
- Scanned the git history for secrets.
- Checked `git status` before every commit to make sure `.env` was not staged.

---

## Decisions

| Decision | Who / why |
|---|---|
| **Queue: pg-boss instead of BullMQ + Redis** | Claude laid out both options. I chose pg-boss: one fewer container, and jobs live in the same Postgres as the data. |
| **Real target: Discord webhook instead of Telegram** | I asked which was easier. Claude said Discord was slightly easier (no bot, one POST) and listed the trade-offs, including that neither has an idempotency key. I switched. |
| **Templates instead of an AI model for variants** | Kept the core deterministic and free. The brief grades enforcement, not generation. |
| **`tsx` instead of a build step** | Fewer moving parts. `tsc` is used only for type checking. |
| **Prisma 6 (pinned)** | Claude warned that newer majors changed the setup. I pinned it to avoid fighting tooling mid-project. |
| **Postgres is the source of truth, pg-boss is the alarm clock** | Claude proposed the split so that lost queue jobs cannot lose work. |

---

## Phase 0: Setup

**AI helped with:** the tool checklist, `.gitignore` and `.gitattributes` as the first commit, project scaffolding, config validation with Zod that fails fast, pino redaction, splitting `app.ts` from `api.ts` so Supertest needs no open port, CI, and Windows specifics (`curl.exe`, LF line endings).

**AI was wrong / I changed:**
- Nothing

**Verified by:** `docker compose ps` healthy, `/health` returning `{"status":"ok"}`, green CI, and `.env` absent from the GitHub repo.

## Phase 1: Design

**AI helped with:** the first draft of `docs/design.md`: data model, status flow, API surface, constraint profiles, the publisher interface, and the idempotency plan.

**I changed:** --

**Verified by:** reading the whole doc before committing. It was later kept in sync with the code (statuses, `dedupesByKey`, the `rejected` and `unknown` split).

## Phase 2: Ingestion and generation

**AI helped with:** the Prisma schema, the grapheme-aware validator (`Intl.Segmenter`), template generators, SSRF protection (private ranges, redirect re-checks, size and time caps), and the API tests.

**AI was wrong / I changed:**
- The command Claude gave for creating `requests/bad-variant.json` did not do what it looked like. The file ended up containing the PowerShell expression as literal text instead of 300 `a` characters, so the "bad" variant would have passed validation. I found this during the code review and fixed it by building the string in a variable first.

**Verified by:** validator unit tests (including the emoji-sequence test), the SSRF test table, and a manual 422 transcript. I also checked that `http://127.0.0.1` ingestion is refused.

## Phase 3: Review workflow

**AI helped with:** the transition rules, race-safe status updates (a conditional `updateMany`), the Slot model, the schedule guard, and the tests.

**A hand-edited migration.** Prisma cannot express a partial unique index, so Claude had me create the migration with `--create-only` and append the SQL by hand (one open slot per variant). I checked that it was applied.

**AI was wrong / I changed:**
- Claude's check command `psql -c '\d "Slot"'` failed in PowerShell ("Did not find any relation named Slot"). PowerShell strips the inner double quotes, so Postgres looked for a lowercase `slot`. It was a quoting problem, not a missing table. I used a `pg_indexes` query instead and confirmed the table with `\dt` and `prisma migrate status`.
- `TODO: paste the pg_indexes output showing Slot_one_open_per_variant with its WHERE clause`
- The Phase 3 guide had me temporarily remove the `attempts` include from `getSlot` (that relation did not exist until Phase 4). I never restored it, so slot responses had no attempts. This was caught in the code review (see below).

**Verified by:** the transcript in `EVIDENCE.md` (409 for a draft, 200 for approve, 201 for schedule), and the test `creates exactly one slot when 5 identical requests race`.

## Phase 4: Adapters and idempotent publish

**AI helped with:** the `SocialPublisher` interface, the Discord adapter (`?wait=true` to get the message ID, `allowed_mentions` suppressed so a post cannot ping `@everyone`), the mock adapters, the registry, the atomic claim SQL, the `rejected` vs `unknown` failure split, the lint rule that keeps business logic from importing concrete adapters, and the tests.

**AI was wrong / I changed:**
- **Design gap (found in review, fixed in Phase 5).** After a timeout (`unknown`), the slot became `failed` but the variant stayed `approved`. That meant it could be scheduled again and Discord could receive a duplicate. Claude's original design did not close this.
- Discord's 2000-character limit is stricter than the LinkedIn profile's 3000, but the limit was only checked when publishing. A valid variant could pass review and scheduling and then fail at the adapter.
- `DISCORD_GUILD_ID` was optional even when Discord was selected, which would leave the message link empty and defeat "the publish record links to the live message".
- The `.env.example` value `replace-me` fails URL validation, so the API refuses to start. Claude anticipated this and gave URL-shaped placeholders.

**Verified by:** the 10-parallel-publish test against a deliberately non-idempotent fake adapter (the adapter is reached exactly once), the database-level second-success test, a real message in my Discord channel, a repeated publish call that produced no second message, and switching `PUBLISHER=mock_x` in `.env` with no code change. I also proved the lint rule works by adding a forbidden import and watching `npm run lint` fail. `TODO: paste or confirm`

## Code review (between Phase 4 and Phase 5)

I uploaded the repository as a zip and asked Claude to look for mistakes. Claude could read the code but could not run it (no database or network in its sandbox), so I still ran typecheck, lint and tests myself.

**Real bugs it found:**
1. `getSlot` still had the `attempts` include commented out, so `GET /slots/:id` and the publish response omitted attempts.
2. `requests/bad-variant.json` contained a literal PowerShell expression instead of 300 characters.
3. `slotsRouter` was mounted twice in `app.ts`.

**Design issues it flagged (all fixed in Phase 5):**
- The manual publish endpoint ignored `scheduledAt`.
- The reschedule-after-`unknown` gap described above.
- Adapter length limits were checked only at publish time.
- `DISCORD_GUILD_ID` was optional for Discord.

**What it checked and found fine:** the claim SQL, both partial unique indexes, the failure classification, the Discord adapter never putting the token in error messages, the lint rule, and no secrets in the zip.

## Phase 5: Scheduling, history, and hardening

**AI helped with:** the pg-boss worker (a cron sweep plus per-slot jobs), DB-driven retries with a backoff and a maximum of 3 attempts, stale-slot recovery, the `POST /slots/:id/resolve` endpoint for an operator to settle an unknown outcome, `GET /history` and a server-rendered `/history/view` with escaping, the kill-the-worker proof script, the Dockerfile and Compose setup, and the seed script.

**Design choices worth remembering:**
- Retries live in the database, not in pg-boss. A retry happens only when it cannot double-post: a retryable rejection, or an unknown outcome on an adapter that dedupes by key.
- For an adapter that cannot dedupe, a crash between send and record is detected and flagged `unknown`. It is never resent automatically. This is the honest answer for Discord, and it is written up as a known limitation.
- The manual publish endpoint is dev-only and is not mounted when `NODE_ENV=production`.

**AI caveats:**
- pg-boss changed its API across major versions (queues must be created before use, and `work` handlers receive an array of jobs). Claude checked the current docs before writing the worker rather than relying on memory. I still had to confirm it with typecheck and a real run.
- `prisma.config.ts` needs `DATABASE_URL` at build time, so the Dockerfile uses a dummy value for `prisma generate` only.

**Verified by:** `npm run prove:crash` (kill the worker after a post is sent but before it is recorded, restart, then one post per slot, zero duplicates), the recovery and retry tests, a real Discord publish from the worker, and a full `docker compose up --build -d` from a clean state. 

## Secrets scan

gitleaks reported one finding: rule `linkedin-client-id`, in `src/adapters/registry.ts` line 3. It was the import line `import { MockLinkedInPublisher, MockXPublisher } from './mock';`. I checked it instead of ignoring it. It is a false positive: the rule matched the class names, and there is no credential in the file. I added `.gitleaks.toml` with `useDefault = true` and an allowlist of only `Mock(LinkedIn|X)Publisher`, so every real rule still runs. The re-run reported no leaks.
## Phase 6: Final dry run



---

## Things I would do differently

- Restore temporarily removed code immediately, instead of relying on a later step to remember it.
- Test the setup commands on the actual shell (PowerShell quoting broke two of them).
- Design the failure path of the publish step (`unknown` outcomes) before the success path, since that is where the real risk sits.

## What AI could not do

- Run anything on my machine, so every claim about "it works" needed my own run.
- Verify a third-party API from memory. Claude looked up current pg-boss docs and I confirmed by running the code.
- Decide the trade-offs for me. The choices in the Decisions table (pg-boss, Discord, templates, pinned Prisma) were mine, made after Claude laid out the options.