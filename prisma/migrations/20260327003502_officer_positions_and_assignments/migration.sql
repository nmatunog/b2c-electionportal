-- CreateTable
CREATE TABLE "OfficerPosition" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "grantsPortalAdmin" BOOLEAN NOT NULL DEFAULT false,
    "maxAssignees" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfficerPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserOfficerAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "isChair" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "appointedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserOfficerAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OfficerPosition_slug_key" ON "OfficerPosition"("slug");

-- CreateIndex
CREATE INDEX "UserOfficerAssignment_positionId_idx" ON "UserOfficerAssignment"("positionId");

-- CreateIndex
CREATE INDEX "UserOfficerAssignment_userId_idx" ON "UserOfficerAssignment"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserOfficerAssignment_userId_positionId_key" ON "UserOfficerAssignment"("userId", "positionId");

-- AddForeignKey
ALTER TABLE "UserOfficerAssignment" ADD CONSTRAINT "UserOfficerAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserOfficerAssignment" ADD CONSTRAINT "UserOfficerAssignment_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "OfficerPosition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
