Used Claude to plan the stack and Phase 0 setup. I verified each command myself.
Claude proposed pinning Prisma 6, template-based generators, and an SSRF check on every redirect hop. I read each file and ran the tests. Handled a few errors.

`Slot_pkey                   | CREATE UNIQUE INDEX "Slot_pkey" ON public."Slot" USING btree (id)
 Slot_idempotencyKey_key     | CREATE UNIQUE INDEX "Slot_idempotencyKey_key" ON public."Slot" USING btree ("idempotencyKey")
 Slot_status_scheduledAt_idx | CREATE INDEX "Slot_status_scheduledAt_idx" ON public."Slot" USING btree (status, "scheduledAt")
 Slot_one_open_per_variant   | CREATE UNIQUE INDEX "Slot_one_open_per_variant" ON public."Slot" USING btree ("variantId") WHERE (status = ANY (ARRAY['scheduled'::"SlotStatus", 'publishing'::"SlotStatus"]))
`
