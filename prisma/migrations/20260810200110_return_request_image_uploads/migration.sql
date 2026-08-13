-- AlterTable
ALTER TABLE "customer_upload_assets" ADD COLUMN     "returnRequestId" TEXT;

-- CreateIndex
CREATE INDEX "customer_upload_assets_returnRequestId_idx" ON "customer_upload_assets"("returnRequestId");

-- AddForeignKey
ALTER TABLE "customer_upload_assets" ADD CONSTRAINT "customer_upload_assets_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "return_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
