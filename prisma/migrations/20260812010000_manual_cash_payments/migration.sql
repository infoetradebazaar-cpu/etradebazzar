ALTER TABLE "payments" ALTER COLUMN "razorpayOrderId" DROP NOT NULL;

ALTER TYPE "PaymentMethod" ADD VALUE 'CASH';

ALTER TABLE "payments" ADD COLUMN "method" "PaymentMethod" NOT NULL DEFAULT 'ONLINE';
ALTER TABLE "payments" ADD COLUMN "recordedByActorId" TEXT;
ALTER TABLE "payments" ADD COLUMN "note" TEXT;
