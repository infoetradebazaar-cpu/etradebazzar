-- AlterTable
ALTER TABLE "seller_kyc"
  ALTER COLUMN "aadharNumber" DROP NOT NULL,
  ALTER COLUMN "panNumber" DROP NOT NULL,
  ADD COLUMN     "gstCertificateUrl" TEXT,
  ADD COLUMN     "msmeCertificateUrl" TEXT,
  ADD COLUMN     "incorporationCertificateUrl" TEXT;
