-- AlterTable
ALTER TABLE "sellers" ADD COLUMN     "gstVerificationMeta" JSONB,
ADD COLUMN     "gstVerificationStatus" "GstPanVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
ADD COLUMN     "gstVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "gstin" TEXT,
ADD COLUMN     "pan" TEXT,
ADD COLUMN     "panVerificationMeta" JSONB,
ADD COLUMN     "panVerificationStatus" "GstPanVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
ADD COLUMN     "panVerifiedAt" TIMESTAMP(3);
