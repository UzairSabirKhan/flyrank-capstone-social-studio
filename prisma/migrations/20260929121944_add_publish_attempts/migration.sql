-- CreateEnum
CREATE TYPE "AttemptResult" AS ENUM ('started', 'published', 'failed', 'unknown');

-- CreateTable
CREATE TABLE "PublishAttempt" (
    "id" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "result" "AttemptResult" NOT NULL DEFAULT 'started',
    "externalId" TEXT,
    "externalUrl" TEXT,
    "error" TEXT,

    CONSTRAINT "PublishAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MockPost" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "preview" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MockPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PublishAttempt_slotId_idx" ON "PublishAttempt"("slotId");

-- CreateIndex
CREATE UNIQUE INDEX "MockPost_idempotencyKey_key" ON "MockPost"("idempotencyKey");

-- AddForeignKey
ALTER TABLE "PublishAttempt" ADD CONSTRAINT "PublishAttempt_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "Slot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The database itself refuses a second successful publish for the same slot.
CREATE UNIQUE INDEX "PublishAttempt_one_success_per_slot"
  ON "PublishAttempt" ("slotId")
  WHERE "result" = 'published';