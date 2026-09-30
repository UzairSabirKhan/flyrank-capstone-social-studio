# Evidence

One proof for each Definition of done box, plus the six acceptance probes. Every proof is a test name
with its output, a log line, or a curl transcript, so a reviewer can re-run it.

**Repository:** `flyrank-capstone-social-studio` · **Last updated:** 2026-09-30

---

## How to reproduce the proofs (This is for myself)

```powershell
# Full test suite, with test names visible (saves the output for pasting below)
npm test -- --reporter=verbose 2>&1 | Tee-Object -FilePath test-output.txt

# One test file
npx vitest run tests/publish.test.ts --reporter=verbose

# Type check and lint
npm run typecheck
npm run lint

# The kill-the-worker proof (stop any other worker first)
npm run prove:crash

# Secrets scan over the whole git history
docker run --rm -v "${PWD}:/repo" zricethezav/gitleaks:latest detect --source /repo -c /repo/.gitleaks.toml -v
```

Screenshots live in `docs/evidence/`. `test-output.txt` is a scratch file: add it to `.gitignore` or delete it after pasting.

---

## Summary

| # | Definition of done box | Proof | Status |
|---|---|---|---|
| 1 | Ingestion | Tests + curl transcript | ☑ |
| 2 | Constraint profiles enforced by code | Validator tests + 422 transcript | ☑ |
| 3 | Review workflow | Review tests + 409/200/201 transcript | ☑ transcript · ☑ test output |
| 4 | Adapter layer and swap | Swap tests + lint-rule failure + mock preview | ☑ |
| 5 | Idempotent publish | 10-parallel test + double-publish transcript + Discord screenshot | ☑ |
| 6 | Durable scheduling | `prove:crash` output + recovery tests | ☑ |
| 7 | Publish history | `/history` JSON + `/history/view` screenshot | ☑ |
| 8 | Secrets clean | `.env.example`, redaction test, gitleaks | ☑ finding · ☑ clean re-run |
| 9 | Tests | Green run + CI | ☑ |
| 10 | README | [README](README.md) | ☑ |

---

## 1. Ingestion

**Claim:** a post enters as a URL or as Markdown and is stored. Variant generation reads only the stored post.

**Tests** (`tests/posts.api.test.ts`):
- `stores a markdown post`
- `rejects an invalid body with 400`
- `refuses a URL that points at a private address` (SSRF guard: nothing is stored)

**Tests** (`tests/ssrf.test.ts`): `rejects http://127.0.0.1/`, `http://localhost/`, `http://10.0.0.5/`, `http://192.168.1.1/`, `http://169.254.169.254/latest/meta-data/`, `http://[::1]/`, `http://2130706433/`, `file:///etc/passwd`, `ftp://example.com/`, `not a url`.

**Source of truth:** `generateVariants` in `src/modules/variants/service.ts` loads the post with `prisma.post.findUnique` and passes only that stored record to the generator. It never touches the original URL or request body.

**Output:**

```
Γ£ô tests/posts.api.test.ts > POST /posts > stores a markdown post 78ms
 Γ£ô tests/posts.api.test.ts > POST /posts > rejects an invalid body with 400 14ms
 Γ£ô tests/posts.api.test.ts > POST /posts > refuses a URL that points at a private address 12ms
 Γ£ô tests/posts.api.test.ts > variant generation > turns one stored post into two different, valid variants 53ms
 Γ£ô tests/posts.api.test.ts > variant generation > returns 409 when variants already exist 57ms
 Γ£ô tests/posts.api.test.ts > constraint enforcement > blocks a rule-breaking variant with a clear 422 and stores nothing 27ms
```


---

## 2. Constraint profiles enforced by code

**Claim:** each platform has a profile (length in graphemes, hashtag count, tone rules). A variant that breaks a rule is blocked with a clear error and never reaches the database, so it never reaches review.

| Rule | X | LinkedIn |
|---|---|---|
| Length (graphemes) | 10–280 | 80–3000 |
| Hashtags | 0–2 | 3–5 |
| Exclamation marks | max 1 | max 1 |
| Emoji | max 3 | max 2 |
| Banned phrases | clickbait list | clickbait list |

**Tests** (`tests/validator.test.ts`):
- `accepts a valid post`
- `blocks text over 280 characters`
- `counts an emoji sequence as one grapheme, not many`
- `blocks more than 2 hashtags`
- `blocks banned phrases`
- `blocks more than one exclamation mark`
- `requires at least 3 hashtags`
- `blocks text over 3000 characters`

**Tests** (`tests/generators.test.ts`): `produces two different variants that both pass their profile`, `is deterministic`.

**Tests** (`tests/posts.api.test.ts`): `turns one stored post into two different, valid variants`, `blocks a rule-breaking variant with a clear 422 and stores nothing`.

**Output:**

```
 Γ£ô tests/validator.test.ts > X profile > accepts a valid post 3ms
 Γ£ô tests/validator.test.ts > X profile > blocks text over 280 characters 1ms
 Γ£ô tests/validator.test.ts > X profile > counts an emoji sequence as one grapheme, not many 1ms
 Γ£ô tests/validator.test.ts > X profile > blocks more than 2 hashtags 0ms
 Γ£ô tests/validator.test.ts > X profile > blocks banned phrases 0ms
 Γ£ô tests/validator.test.ts > X profile > blocks more than one exclamation mark 0ms
 Γ£ô tests/validator.test.ts > LinkedIn profile > requires at least 3 hashtags 1ms
 Γ£ô tests/validator.test.ts > LinkedIn profile > blocks text over 3000 characters 3ms
 Γ£ô tests/generators.test.ts > template generators > produces two different variants that both pass their profile 5ms
 Γ£ô tests/generators.test.ts > template generators > is deterministic 1ms
 Γ£ô tests/posts.api.test.ts > variant generation > turns one stored post into two different, valid variants 53ms
 Γ£ô tests/posts.api.test.ts > constraint enforcement > blocks a rule-breaking variant with a clear 422 and stores nothing 27ms
```

**Blocked-variant transcript** (a 300-character X variant):

```
curl.exe -X POST http://localhost:3000/posts/<ID>/variants -H "Content-Type: application/json" --data "@requests/bad-variant.json"
{"error":{"code":"VARIANT_RULE_VIOLATION","message":"Variant breaks x rules","details":[{"code":"TOO_LONG","message":"x: 300 characters, maximum is 280"}]}}
```

---

## 3. Review workflow

**Claim:** variants move `draft → approved | rejected → published`. Only an approved variant can be scheduled. An unapproved schedule attempt returns a clean 4xx and creates no slot.

**Tests** (`tests/review.api.test.ts`):
- `approves a draft variant`
- `refuses to approve twice`
- `rejects a draft, and a rejected variant cannot be approved`
- `blocks an edit that breaks the profile and leaves the text unchanged`
- `sends an edited approved variant back to draft`
- `refuses to schedule a draft variant with 409 and creates no slot`
- `refuses to schedule a rejected variant`
- `schedules an approved variant`
- `treats a repeated identical request as a replay, not a second slot`
- `creates exactly one slot when 5 identical requests race`
- `refuses a second slot at a different time`
- `refuses a time in the past and a malformed body`
- `blocks edit and reject while a slot is open, and allows them after cancelling`

**Output:**

```
Γ£ô tests/review.api.test.ts > review workflow > approves a draft variant 824ms
 Γ£ô tests/review.api.test.ts > review workflow > refuses to approve twice 90ms
 Γ£ô tests/review.api.test.ts > review workflow > rejects a draft, and a rejected variant cannot be approved 59ms
 Γ£ô tests/review.api.test.ts > review workflow > blocks an edit that breaks the profile and leaves the text unchanged 31ms
 Γ£ô tests/review.api.test.ts > review workflow > sends an edited approved variant back to draft 52ms
 Γ£ô tests/review.api.test.ts > scheduling guard > refuses to schedule a draft variant with 409 and creates no slot 44ms
 Γ£ô tests/review.api.test.ts > scheduling guard > refuses to schedule a rejected variant 53ms
 Γ£ô tests/review.api.test.ts > scheduling guard > schedules an approved variant 52ms
 Γ£ô tests/review.api.test.ts > scheduling guard > treats a repeated identical request as a replay, not a second slot 75ms
 Γ£ô tests/review.api.test.ts > scheduling guard > creates exactly one slot when 5 identical requests race 110ms
 Γ£ô tests/review.api.test.ts > scheduling guard > refuses a second slot at a different time 61ms
 Γ£ô tests/review.api.test.ts > scheduling guard > refuses a time in the past and a malformed body 47ms
 Γ£ô tests/review.api.test.ts > scheduling guard > blocks edit and reject while a slot is open, and allows them after cancelling 87ms
```

**Live transcript** (2026-09-29, helmet headers removed for readability). The variant was scheduled while still a draft, then approved, then scheduled again:

```
$ curl -i -X POST /variants/<id>/schedule        (variant is still draft)
HTTP/1.1 409 Conflict
{"error":{"code":"VARIANT_NOT_APPROVED","message":"Only approved variants can be scheduled (this one is draft)"}}

$ curl -i -X POST /variants/8ca6e88b-fd97-4df1-84fb-9c5309c26c17/approve
HTTP/1.1 200 OK
{"variant":{"id":"8ca6e88b-fd97-4df1-84fb-9c5309c26c17","postId":"2f75d2a1-b146-485d-9648-7fa96ba98f7c",
 "platform":"x","text":"Why Idempotency Matters: Publishing systems retry on failure.\n\n#Idempotency #Matters",
 "status":"approved","createdAt":"2026-09-29T11:47:31.000Z","updatedAt":"2026-09-29T11:47:31.276Z"}}

$ curl -i -X POST /variants/8ca6e88b-fd97-4df1-84fb-9c5309c26c17/schedule
HTTP/1.1 201 Created
{"slot":{"id":"2fe0833e-53a0-44b3-a96b-878b6c0bd25a","variantId":"8ca6e88b-fd97-4df1-84fb-9c5309c26c17",
 "scheduledAt":"2026-09-29T11:49:31.045Z","status":"scheduled",
 "idempotencyKey":"8ca6e88b-fd97-4df1-84fb-9c5309c26c17:2fe0833e-53a0-44b3-a96b-878b6c0bd25a",
 "claimedAt":null, ...},"replayed":false}
```

This shows the guard (409), the approval (200), the scheduling of an approved variant (201), and the idempotency key format `variantId:slotId`.

**Database-level protection.** The rule "one open slot per variant" is enforced by a partial unique index, not only by application code:

```
 Slot_pkey                   | CREATE UNIQUE INDEX "Slot_pkey" ON public."Slot" USING btree (id)
 Slot_idempotencyKey_key     | CREATE UNIQUE INDEX "Slot_idempotencyKey_key" ON public."Slot" USING btree ("idempotencyKey")
 Slot_status_scheduledAt_idx | CREATE INDEX "Slot_status_scheduledAt_idx" ON public."Slot" USING btree (status, "scheduledAt")
 Slot_one_open_per_variant   | CREATE UNIQUE INDEX "Slot_one_open_per_variant" ON public."Slot" USING btree ("variantId") WHERE (status = ANY (ARRAY
['scheduled'::"SlotStatus", 'publishing'::"SlotStatus"]))
(4 rows)
```

---

## 4. Adapter layer and swap

**Claim:** one `SocialPublisher` interface, one real target (Discord webhook), and two mock adapters. The application depends on the interface only. Swapping the adapter changes configuration, not business logic.

**Interface:** `src/adapters/SocialPublisher.ts`. **Registry (the only file that knows which adapters exist):** `src/adapters/registry.ts`.

**Tests** (`tests/adapters.test.ts`):
- `publishes the same campaign through mock_x by configuration alone`
- `publishes the same campaign through mock_linkedin by configuration alone`
- `builds the discord adapter from config, and refuses without a webhook`
- `creates one post per idempotency key, however often it is called`
- `posts with wait=true, suppresses mentions, and returns the message link`
- `maps HTTP 429 / 400 / 404 to kind rejected` and `maps HTTP 500 / 503 to kind unknown`
- `treats a network failure as unknown and never leaks the webhook token`
- `refuses over-long text without calling Discord`

**Output:**

```
Γ£ô tests/adapters.test.ts > adapter swap > publishes the same campaign through mock_x by configuration alone 187ms
 Γ£ô tests/adapters.test.ts > adapter swap > publishes the same campaign through mock_linkedin by configuration alone 84ms
 Γ£ô tests/adapters.test.ts > adapter swap > builds the discord adapter from config, and refuses without a webhook 8ms
 Γ£ô tests/adapters.test.ts > mock adapter > creates one post per idempotency key, however often it is called 44ms
 Γ£ô tests/adapters.test.ts > discord adapter (fetch mocked, no network) > posts with wait=true, suppresses mentions, and returns the message link 15ms
 Γ£ô tests/adapters.test.ts > discord adapter (fetch mocked, no network) > maps HTTP 429 to kind rejected 5ms
 Γ£ô tests/adapters.test.ts > discord adapter (fetch mocked, no network) > maps HTTP 400 to kind rejected 4ms
 Γ£ô tests/adapters.test.ts > discord adapter (fetch mocked, no network) > maps HTTP 404 to kind rejected 4ms
 Γ£ô tests/adapters.test.ts > discord adapter (fetch mocked, no network) > maps HTTP 500 to kind unknown 5ms
 Γ£ô tests/adapters.test.ts > discord adapter (fetch mocked, no network) > maps HTTP 503 to kind unknown 5ms
 Γ£ô tests/adapters.test.ts > discord adapter (fetch mocked, no network) > treats a network failure as unknown and never leaks the webhook token 4ms
 Γ£ô tests/adapters.test.ts > discord adapter (fetch mocked, no network) > refuses over-long text without calling Discord 4ms
```


**Swap without a code change** (Probe 6 detail). Only `PUBLISHER` in `.env` changed, from `discord` to `mock_x`:

```
{"history":[{"attemptId":"84e93b68-187d-41e6-8714-d7dd3f0ca8ad","slotId":"76b73a10-9bb0-43f5-a0af-3742e67e4354","variantId":"1f7b24af-218d-42e2-83b4-0515fbe7e64d","platform":"x","slotStatus":"published","scheduledAt":"2026-09-29T23:37:19.970Z","startedAt":"2026-09-29T23:37:27.847Z","finishedAt":"2026-09-29T23:37:27.935Z","result":"published","externalId":"75fb9c0e-a10b-498f-b129-83870089c4f2","externalUrl":null,"error":null},{"attemptId":"d931e0c7-01ae-41f7-87d3-092e37a78266","slotId":"2d666548-136c-4bf5-a9cd-0aff0f84a47b","variantId":"1cd4abc1-9d87-4af7-b0b5-2f14feeb74e0","platform":"x","slotStatus":"published","scheduledAt":"2026-09-29T18:27:21.869Z","startedAt":"2026-09-29T23:34:59.276Z","finishedAt":"2026-09-29T23:34:59.301Z","result":"published","externalId":"ddae4d15-0d1d-4184-8d75-e0ddc5d77d4b","externalUrl":null,"error":null},{"attemptId":"5e916dc4-f842-4606-9ec5-34e2b4698ae9","slotId":"4e31515a-f888-4076-9b1d-dcc0a76e982b","variantId":"7190cf6b-fd67-4986-8ff2-8c9f49f723c9","platform":"x","slotStatus":"published","scheduledAt":"2026-09-29T18:25:40.798Z","startedAt":"2026-09-29T23:34:57.254Z","finishedAt":"2026-09-29T23:34:57.270Z","result":"published","externalId":"fa15ca8c-05cd-403c-aa23-2f21b3c01ea5","externalUrl":null,"error":null},{"attemptId":"5481f7cf-323a-4b66-b151-a92f42ec28fc","slotId":"2fe0833e-53a0-44b3-a96b-878b6c0bd25a","variantId":"8ca6e88b-fd97-4df1-84fb-9c5309c26c17","platform":"x","slotStatus":"published","scheduledAt":"2026-09-29T11:49:31.045Z","startedAt":"2026-09-29T23:34:55.238Z","finishedAt":"2026-09-29T23:34:55.253Z","result":"published","externalId":"f4e4b132-c201-4876-8831-356fc84c5aa8","externalUrl":null,"error":null},{"attemptId":"3e62ce8a-889f-446d-932d-8de2397b1874","slotId":"9a7203c7-5339-468d-9ce6-e2e76eab9cd7","variantId":"2ad7c2bc-54a7-4c73-ad02-548468801c0d","platform":"x","slotStatus":"published","scheduledAt":"2026-09-29T11:48:12.109Z","startedAt":"2026-09-29T23:34:53.236Z","finishedAt":"2026-09-29T23:34:53.257Z","result":"published","externalId":"e1ac98f3-37a0-4c1c-bd65-5b7bf098f3ce","externalUrl":null,"error":null},{"attemptId":"12e846d6-63ae-435a-bcbe-aead7b9b78b5","slotId":"3060e60a-9336-40f9-a027-2765ee85ca81","variantId":"7ed18f83-29ed-4e52-a953-148eb0f6e773","platform":"x","slotStatus":"published","scheduledAt":"2026-09-29T17:25:55.345Z","startedAt":"2026-09-29T17:24:49.163Z","finishedAt":"2026-09-29T17:24:50.320Z","result":"published","externalId":"1554544495607939095","externalUrl":"https://discord.com/channels/1554447541322522697/1554447542316699690/1554544495607939095","error":null}]}
```

---

## 5. Idempotent publish

**Claim:** the same variant in the same slot posts once, even under retries and parallel callers.

**How it works:**
1. An atomic `UPDATE ... WHERE status='scheduled' AND variant is approved RETURNING ...` claims the slot. Only one caller gets a row back.
2. The database refuses a second successful attempt for one slot (a partial unique index on `PublishAttempt`).
3. Mock adapters also dedupe by idempotency key (`MockPost.idempotencyKey` is UNIQUE).
4. Failures are classified as `rejected` (definitely not posted) or `unknown` (might have posted). An unknown outcome is never blindly resent to an adapter that cannot dedupe.

**Tests** (`tests/publish.test.ts`):
- `publishes exactly once when the same slot is published 10 times in parallel`
- `does not call the adapter again once a slot is published`
- `refuses to publish if the variant is no longer approved`
- `records an unknown outcome when the platform times out`
- `records a platform rejection as failed`
- `rejects an unknown slot with 404`
- `lets the database itself refuse a second success for one slot`

**Tests** (`tests/retry.test.ts`):
- `reschedules a retryable rejection with a backoff`
- `does not retry a permanent rejection`
- `retries an unknown outcome only when the adapter dedupes by key`
- `gives up after the maximum number of attempts`
- `does not publish a slot that is not due yet when requireDue is set`

**Output:**

```
Γ£ô tests/retry.test.ts > retry policy > reschedules a retryable rejection with a backoff 309ms
 Γ£ô tests/retry.test.ts > retry policy > does not retry a permanent rejection 176ms
 Γ£ô tests/retry.test.ts > retry policy > retries an unknown outcome only when the adapter dedupes by key 308ms
 Γ£ô tests/retry.test.ts > retry policy > gives up after the maximum number of attempts 368ms
 Γ£ô tests/retry.test.ts > retry policy > does not publish a slot that is not due yet when requireDue is set 176ms
 Γ£ô tests/publish.test.ts > idempotent publish > publishes exactly once when the same slot is published 10 times in parallel 241ms
 Γ£ô tests/publish.test.ts > idempotent publish > does not call the adapter again once a slot is published 152ms
 Γ£ô tests/publish.test.ts > idempotent publish > refuses to publish if the variant is no longer approved 138ms
 Γ£ô tests/publish.test.ts > idempotent publish > records an unknown outcome when the platform times out 185ms
 Γ£ô tests/publish.test.ts > idempotent publish > records a platform rejection as failed 165ms
 Γ£ô tests/publish.test.ts > idempotent publish > rejects an unknown slot with 404 29ms
 Γ£ô tests/publish.test.ts > idempotent publish > lets the database itself refuse a second success for one slot 72ms
```

**Real Discord double-publish** (the same slot published twice through the dev endpoint):

```
curl.exe -i -X POST "http://localhost:3000/slots/3060e60a-9336-40f9-a027-2765ee85ca81/publish"                            

HTTP/1.1 200 OK

{"outcome":"published","slot":{"id":"3060e60a-9336-40f9-a027-2765ee85ca81","variantId":"7ed18f83-29ed-4e52-a953-148eb0f6e773","scheduledAt":"2026-09-29T17:25:55.345Z","status":"published","idempotencyKey":"7ed18f83-29ed-4e52-a953-148eb0f6e773:3060e60a-9336-40f9-a027-2765ee85ca81","claimedAt":"2026-09-29T17:24:49.136Z","createdAt":"2026-09-29T17:23:55.425Z","updatedAt":"2026-09-29T17:24:50.329Z","variant":{"id":"7ed18f83-29ed-4e52-a953-148eb0f6e773","platform":"x","status":"published"}}}

curl.exe -i -X POST "http://localhost:3000/slots/3060e60a-9336-40f9-a027-2765ee85ca81/publish"
HTTP/1.1 200 OK
{"outcome":"noop","slot":{"id":"3060e60a-9336-40f9-a027-2765ee85ca81","variantId":"7ed18f83-29ed-4e52-a953-148eb0f6e773","scheduledAt":"2026-09-29T17:25:55.345Z","status":"published","idempotencyKey":"7ed18f83-29ed-4e52-a953-148eb0f6e773:3060e60a-9336-40f9-a027-2765ee85ca81","claimedAt":"2026-09-29T17:24:49.136Z","createdAt":"2026-09-29T17:23:55.425Z","updatedAt":"2026-09-29T17:24:50.329Z","variant":{"id":"7ed18f83-29ed-4e52-a953-148eb0f6e773","platform":"x","status":"published"}}}
```

**Screenshot:** ![Exactly one message in the channel](docs/evidence/discord-one-message.png)


---

## 6. Durable scheduling

**Claim:** a worker that stops mid-batch continues safely on restart, with zero duplicate posts.

**Design:** Postgres is the source of truth. pg-boss provides a durable one-minute cron sweep and per-slot jobs. Each sweep enqueues due slots and recovers stale `publishing` slots. If every pg-boss job were lost, the next sweep would rebuild the work from the `Slot` table.

**Recovery rules for a slot stuck in `publishing`:**
- The adapter dedupes by key (mocks): publish again with the same key, then record the result.
- The adapter cannot dedupe (Discord): do not resend. Flag the attempt `unknown` for a human, who resolves it with `POST /slots/:id/resolve`. The variant cannot be scheduled again until then.

**Kill-the-worker proof.** `npm run prove:crash` seeds 5 due slots, starts a real worker process, hard-kills it after a post was sent but before it was recorded, restarts it, and checks every slot:

```
npm run prove:crash

=== RESULT ===
slot 1: successful attempts=1, posts created=1
slot 2: successful attempts=1, posts created=1
{"level":30,"time":1790730997630,"pid":10472,"hostname":"MSI-097","slotId":"033669b8-71a4-405e-9456-1b79a6fdaf8a","outcome":"noop","msg":"publish job finished"}
slot 3: successful attempts=1, posts created=1
slot 4: successful attempts=1, posts created=1
slot 5: successful attempts=1, posts created=1
total posts for 5 slots: 5

PASS: exactly one post per slot, zero duplicates

```

**Tests** (`tests/recovery.test.ts`):
- `enqueues only due slots`
- `finishes a crash-after-send exactly once when the adapter dedupes by key`
- `never re-sends when the adapter cannot dedupe, and flags it for a human`
- `marks the variant published when an operator confirms it was posted`
- `ignores a slot that is not stale`
- `lets exactly one of two concurrent recoverers act`

**Output:**

```
Γ£ô tests/recovery.test.ts > sweep > enqueues only due slots 194ms
 Γ£ô tests/recovery.test.ts > stale slot recovery > finishes a crash-after-send exactly once when the adapter dedupes by key 112ms
 Γ£ô tests/recovery.test.ts > stale slot recovery > never re-sends when the adapter cannot dedupe, and flags it for a human 144ms
 Γ£ô tests/recovery.test.ts > stale slot recovery > marks the variant published when an operator confirms it was posted 110ms
 Γ£ô tests/recovery.test.ts > stale slot recovery > ignores a slot that is not stale 58ms
 Γ£ô tests/recovery.test.ts > stale slot recovery > lets exactly one of two concurrent recoverers act 160ms
```


---

## 7. Publish history

**Claim:** each publish attempt is recorded with its result and is visible, including a link to the live message.

- JSON: `GET /history` (filters: `limit`, `slotId`)
- HTML: `GET /history/view` (server-rendered and escaped, plus mock previews)

**Tests** (`tests/history.api.test.ts`):
- `lists attempts with platform, result and filters`
- `renders an HTML view and escapes stored content`

**Output:**

```
Γ£ô tests/history.api.test.ts > publish history > lists attempts with platform, result and filters 276ms
 Γ£ô tests/history.api.test.ts > publish history > renders an HTML view and escapes stored content 93ms
```

**Live JSON:**

```
curl.exe -s http://localhost:3000/history

{"history":[{"attemptId":"08d76e4e-d036-43aa-83dd-37b89a63d7a1","slotId":"9e9ae688-566c-4d7f-b292-6c28cb129add","variantId":"e699c69a-a850-4d2b-acec-832cdc08aba9","platform":"x","slotStatus":"published","scheduledAt":"2026-09-30T00:09:58.307Z","startedAt":"2026-09-30T00:10:27.171Z","finishedAt":"2026-09-30T00:10:27.667Z","result":"published","externalId":"1554646577568677932","externalUrl":"https://discord.com/channels/1554447541322522697/1554447542316699690/1554646577568677932","error":null},
{"attemptId":"70bbd89f-73cb-4ace-bcc6-0d86b35e3c0e","slotId":"a8269248-da94-4a51-a965-1ed7c0003fbf","variantId":"29a5884b-9813-43d9-ad6a-354137ba088a","platform":"x","slotStatus":"published","scheduledAt":"2026-09-29T23:45:29.623Z","startedAt":"2026-09-29T23:49:30.626Z","finishedAt":"2026-09-29T23:49:34.670Z","result":"published","externalId":"5aba56e3-22bf-4c1e-bafe-feee6a252968","externalUrl":null,"error":null},{"attemptId":"aeba4b1b-0bb2-4339-93c3-fbf13e09ff32","slotId":"15da3c9c-bd2d-4efd-9630-a1af68bca96e","variantId":"5eda1bbf-8fdf-4e53-8b81-b34144f67122","platform":"x","slotStatus":"published","scheduledAt":"2026-09-29T23:44:49.456Z","startedAt":"2026-09-29T23:45:30.517Z","finishedAt":"2026-09-29T23:45:30.931Z","result":"published","externalId":"1554640300025057353","externalUrl":"https://discord.com/channels/1554447541322522697/1554447542316699690/1554640300025057353","error":null}]}
```

---

## 8. Secrets clean

- `.env` is in `.gitignore`, which was part of the first commit. `.env.example` ships with safe placeholders. The webhook URL and server ID exist only in the local `.env`.
- **The token never leaks through errors.** Test: `treats a network failure as unknown and never leaks the webhook token`. The Discord adapter's error messages never include the caught error or the URL.
- **Logger redaction.** `src/lib/logger.ts` uses pino `redact` for the webhook URL and authorization headers.
- **The Docker image contains no secrets.** `.dockerignore` excludes `.env`. Compose passes configuration at runtime.
- **The API never leaks internals.** The error middleware returns a generic 500 body and logs the real error server-side only.

**Secrets scan over the whole git history (gitleaks).**

First run, 8 commits scanned, 1 finding:

```
Finding:     import { MockLinkedInPublisher, MockXPublisher } from './mock';
Secret:      MockXPublisher
RuleID:      linkedin-client-id
Entropy:     3.807355
File:        src/adapters/registry.ts
Line:        3
Commit:      734074bce0ddd8d0574672a5c134959ccf55ce2f
```

**Triage:** a false positive. The `linkedin-client-id` rule matched the class names `MockLinkedInPublisher` and `MockXPublisher` in an import line. There is no credential in that file. Resolution: `.gitleaks.toml` keeps all default rules (`useDefault = true`) and allowlists only the regex `Mock(LinkedIn|X)Publisher`, so a real LinkedIn key added later would still be flagged.

Clean re-run:

```

    ○
    │╲
    │ ○
    ○ ░
    ░    gitleaks

12:21AM INF 8 commits scanned.
12:21AM INF scanned ~275119 bytes (275.12 KB) in 2.6s
12:21AM INF no leaks found
```

---

## 9. Tests

The scary cases run green and deterministically: blocked variant, refused schedule, duplicate publish, adapter swap, crash recovery, retry policy.

```
`npm test`
Test Files  11 passed (11)
      Tests  74 passed (74)
   Start at  04:24:59
   Duration  19.27s (import 63%, tests 33%, transform 4%)


`npm run typecheck`
`npm run lint`
no errors
```

**CI:** GitHub Actions runs typecheck, lint, and the tests against a Postgres service.
Latest green run: `TODO: link to the Actions run`

Design notes that keep the tests deterministic:
- A separate `studio_test` database, wiped before each test.
- Test files run serially (`fileParallelism: false`).
- Discord is tested with a mocked `fetch`, so there is no network call and no real token.
- The race tests use `Promise.all` and a deliberately non-idempotent fake adapter, so it is the claim doing the protecting, not the fake.

---

## 10. README

`README.md` covers what the system does, an architecture diagram, exact run and seed steps (`docker compose up --build -d` then `docker compose exec api npx tsx scripts/seed.ts`), how duplicates are prevented, and known limitations.

Link: [README](README.md)

---

# The six acceptance probes

Run from a fresh clone, following only the README. Date of the dry run: `TODO`.

| Probe | What was done | Result | Proof |
|---|---|---|---|
| **1. Ingest → variants pass their profiles** | Ingested the sample post. Generated variants for `x` and `linkedin`. | ☐ |  |
| **2. Rule-breaking variant is blocked before review** | Posted a 300-character X variant. | ☐ 422 `VARIANT_RULE_VIOLATION`, nothing stored | See section 2 |
| **3. Unapproved schedule is refused** | Scheduled a draft variant. | ☑ 409 `VARIANT_NOT_APPROVED` | See section 3 |
| **4. Approve, schedule 2 min out, publish to the real target** | Approved, scheduled 2 minutes out. The worker published to Discord. | ☐ | History row with a live `externalUrl` and a screenshot |
| **5. Kill the worker mid-publish, restart, exactly one post** | `npm run prove:crash` | ☐ | See section 6 |
| **6. Swap the adapter in configuration** | Changed `PUBLISHER` from `discord` to `mock_x` in `.env` and restarted. | ☐ | See section 4 |

---

## Known limitations (also listed in the README)

- Discord webhooks have no idempotency key. A crash between send and record is detected and flagged `unknown` for a human. It is never automatically resent.
- Cron has one-minute granularity, so a post publishes up to about a minute after its slot time.
- The app and database clocks are assumed to be in sync. `STALE_AFTER_SECONDS` must exceed the slowest publish.
- URL ingestion resolves DNS before fetching. A DNS-rebinding race is a documented residual risk.
- Single-operator tool: no authentication.