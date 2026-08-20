ALTER TYPE "NegotiationSessionStatus" ADD VALUE 'EXPIRED';

INSERT INTO "platform_configs" ("id", "key", "value", "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, 'manual_negotiation_timeout_days', '7', NOW(), NOW())
ON CONFLICT ("key") DO NOTHING;
