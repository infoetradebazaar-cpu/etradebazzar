CREATE UNIQUE INDEX "carts_shared_per_org" ON "carts"("orgId") WHERE "orgId" IS NOT NULL;
