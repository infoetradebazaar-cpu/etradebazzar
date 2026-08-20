ALTER TABLE "negotiation_sessions" ADD COLUMN "resumedFromSessionId" TEXT;

CREATE INDEX "negotiation_sessions_resumedFromSessionId_idx" ON "negotiation_sessions"("resumedFromSessionId");

ALTER TABLE "negotiation_sessions" ADD CONSTRAINT "negotiation_sessions_resumedFromSessionId_fkey" FOREIGN KEY ("resumedFromSessionId") REFERENCES "negotiation_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
