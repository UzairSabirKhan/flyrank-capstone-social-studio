-- CreateEnum
CREATE TYPE "SlotStatus" AS ENUM ('scheduled', 'publishing', 'published', 'failed');

-- CreateTable
CREATE TABLE "Slot" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "SlotStatus" NOT NULL DEFAULT 'scheduled',
    "idempotencyKey" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Slot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Slot_idempotencyKey_key" ON "Slot"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Slot_status_scheduledAt_idx" ON "Slot"("status", "scheduledAt");

-- AddForeignKey
ALTER TABLE "Slot" ADD CONSTRAINT "Slot_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One open (scheduled or publishing) slot per variant. Enforced by the database.
CREATE UNIQUE INDEX "Slot_one_open_per_variant"
  ON "Slot" ("variantId")
  WHERE "status" IN ('scheduled', 'publishing');