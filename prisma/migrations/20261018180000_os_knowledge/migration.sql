-- CreateEnum
CREATE TYPE "SetterAutonomy" AS ENUM ('APPROVE', 'AUTO');

-- CreateEnum
CREATE TYPE "ResourceStatus" AS ENUM ('ACTIVE', 'TEST', 'DRAFT');

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "setterId" TEXT;

-- AlterTable
ALTER TABLE "Draft" ADD COLUMN     "setterId" TEXT;

-- CreateTable
CREATE TABLE "Setter" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "autonomy" "SetterAutonomy" NOT NULL DEFAULT 'APPROVE',
    "instagramAccountId" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "business" JSONB NOT NULL DEFAULT '{}',
    "offers" JSONB NOT NULL DEFAULT '[]',
    "funnel" JSONB NOT NULL DEFAULT '[]',
    "voice" TEXT NOT NULL DEFAULT '',
    "voiceExamples" TEXT NOT NULL DEFAULT '',
    "examples" TEXT NOT NULL DEFAULT '',
    "voiceCorrections" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resource" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'resource',
    "name" TEXT NOT NULL,
    "link" TEXT,
    "keyword" TEXT,
    "status" "ResourceStatus" NOT NULL DEFAULT 'DRAFT',
    "description" TEXT NOT NULL DEFAULT '',
    "data" JSONB NOT NULL DEFAULT '{}',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetterResource" (
    "setterId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SetterResource_pkey" PRIMARY KEY ("setterId","resourceId")
);

-- CreateTable
CREATE TABLE "CampaignSetter" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "setterId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignSetter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Setter_workspaceId_idx" ON "Setter"("workspaceId");

-- CreateIndex
CREATE INDEX "Setter_workspaceId_instagramAccountId_idx" ON "Setter"("workspaceId", "instagramAccountId");

-- CreateIndex
CREATE INDEX "Resource_workspaceId_idx" ON "Resource"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Resource_workspaceId_slug_key" ON "Resource"("workspaceId", "slug");

-- CreateIndex
CREATE INDEX "SetterResource_resourceId_idx" ON "SetterResource"("resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignSetter_automationId_key" ON "CampaignSetter"("automationId");

-- CreateIndex
CREATE INDEX "CampaignSetter_workspaceId_idx" ON "CampaignSetter"("workspaceId");

-- CreateIndex
CREATE INDEX "CampaignSetter_setterId_idx" ON "CampaignSetter"("setterId");

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_setterId_fkey" FOREIGN KEY ("setterId") REFERENCES "Setter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetterResource" ADD CONSTRAINT "SetterResource_setterId_fkey" FOREIGN KEY ("setterId") REFERENCES "Setter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetterResource" ADD CONSTRAINT "SetterResource_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignSetter" ADD CONSTRAINT "CampaignSetter_setterId_fkey" FOREIGN KEY ("setterId") REFERENCES "Setter"("id") ON DELETE CASCADE ON UPDATE CASCADE;
