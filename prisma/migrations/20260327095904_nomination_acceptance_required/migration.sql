-- AlterTable
ALTER TABLE "Nomination" ADD COLUMN     "nomineeB2cId" TEXT,
ADD COLUMN     "respondedAt" TIMESTAMP(3),
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'pending';

-- CreateIndex
CREATE INDEX "Nomination_nomineeB2cId_idx" ON "Nomination"("nomineeB2cId");

-- AddForeignKey
ALTER TABLE "Nomination" ADD CONSTRAINT "Nomination_nomineeB2cId_fkey" FOREIGN KEY ("nomineeB2cId") REFERENCES "User"("b2cId") ON DELETE SET NULL ON UPDATE CASCADE;
