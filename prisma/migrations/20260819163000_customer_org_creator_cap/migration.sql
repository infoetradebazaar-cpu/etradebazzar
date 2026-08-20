-- AlterTable: add nullable first so existing rows don't fail NOT NULL.
ALTER TABLE "customer_orgs" ADD COLUMN "createdBy" TEXT;

-- Backfill: earliest member holding the org's default 'admin' role.
UPDATE "customer_orgs" co
SET "createdBy" = (
  SELECT cm."userId"
  FROM "customer_org_members" cm
  JOIN "customer_org_roles" cr ON cr.id = cm."roleId"
  WHERE cm."orgId" = co.id AND cr.name = 'admin'
  ORDER BY cm."createdAt" ASC
  LIMIT 1
)
WHERE co."createdBy" IS NULL;

-- rather than leaving createdBy NULL or guessing.
DO $$
DECLARE
  orphaned INT;
BEGIN
  SELECT count(*) INTO orphaned FROM "customer_orgs" WHERE "createdBy" IS NULL;
  IF orphaned > 0 THEN
    RAISE EXCEPTION 'customer_org_creator_cap: % customer_orgs row(s) have no admin member to backfill createdBy from', orphaned;
  END IF;
END $$;

ALTER TABLE "customer_orgs" ALTER COLUMN "createdBy" SET NOT NULL;

CREATE INDEX "customer_orgs_createdBy_idx" ON "customer_orgs"("createdBy");

ALTER TABLE "customer_orgs" ADD CONSTRAINT "customer_orgs_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
