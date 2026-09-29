-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('url', 'markdown');

-- CreateEnum
CREATE TYPE "VariantStatus" AS ENUM ('draft', 'approved', 'rejected', 'published');

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL,
    "sourceType" "SourceType" NOT NULL,
    "sourceUrl" TEXT,
    "title" TEXT NOT NULL,
    "bodyMarkdown" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Variant" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" "VariantStatus" NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Variant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Variant_postId_platform_key" ON "Variant"("postId", "platform");

-- AddForeignKey
ALTER TABLE "Variant" ADD CONSTRAINT "Variant_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
