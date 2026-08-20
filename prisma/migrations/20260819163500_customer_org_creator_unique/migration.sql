DROP INDEX "customer_orgs_createdBy_idx";
ALTER TABLE "customer_orgs" ADD CONSTRAINT "customer_orgs_createdBy_key" UNIQUE ("createdBy");
