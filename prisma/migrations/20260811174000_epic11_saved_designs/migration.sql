-- CreateTable
CREATE TABLE "saved_designs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "skuId" TEXT,
    "name" TEXT,
    "customizationState" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_designs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saved_designs_userId_idx" ON "saved_designs"("userId");
CREATE INDEX "saved_designs_productId_idx" ON "saved_designs"("productId");

-- AddForeignKey
ALTER TABLE "saved_designs" ADD CONSTRAINT "saved_designs_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "saved_designs" ADD CONSTRAINT "saved_designs_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "saved_designs" ADD CONSTRAINT "saved_designs_skuId_fkey"
  FOREIGN KEY ("skuId") REFERENCES "product_skus"("id") ON DELETE SET NULL ON UPDATE CASCADE;
