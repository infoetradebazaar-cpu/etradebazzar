-- AlterTable
ALTER TABLE "shops"
  ALTER COLUMN "category" DROP NOT NULL,
  ADD COLUMN     "userName" TEXT,
  ADD COLUMN     "gstCertificateUrl" TEXT,
  ADD COLUMN     "contacts" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "shops_userName_key" ON "shops"("userName");
