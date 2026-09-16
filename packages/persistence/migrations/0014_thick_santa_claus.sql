-- DEC-134: the plain UNIQUE(financial_profile_id, match_type, pattern)
-- constraint added by DEC-133 never actually protected the GLOBAL tier —
-- Postgres treats every NULL as distinct in a unique constraint, so any
-- number of financial_profile_id IS NULL rows sharing a (match_type,
-- pattern) would have passed it silently. Before replacing it with two
-- correct partial unique indexes (one per tier), this repairs any
-- pre-existing state that would violate them:
--
-- 1. every row from before DEC-132 (origin never written) is, in fact, a
--    global SYSTEM_DEFAULT rule — backfilled explicitly so the ownership
--    CHECK constraint added below has no ambiguous NULL origins to reason
--    about, even though Postgres would treat a NULL check result as
--    passing anyway.
-- 2. any accidental duplicate GLOBAL rule for the same (match_type,
--    pattern) — never expected in practice (fixtures/rules.ts is
--    hand-curated to already avoid this, and seed.ts's upsert is id-keyed),
--    but defensive in the same spirit as DEC-131's PaymentSource repair —
--    is collapsed to one row (lowest id kept, deterministic) before the new
--    unique index is created, so CREATE UNIQUE INDEX cannot fail on
--    pre-existing bad data. No downstream table references
--    category_rules.id via FK, so no repointing step is needed (unlike
--    DEC-131's PaymentSource repair).
UPDATE category_rules SET origin = 'SYSTEM_DEFAULT' WHERE origin IS NULL;
--> statement-breakpoint
DELETE FROM category_rules a
USING category_rules b
WHERE a.financial_profile_id IS NULL
  AND b.financial_profile_id IS NULL
  AND a.match_type = b.match_type
  AND a.pattern = b.pattern
  AND a.id > b.id;
--> statement-breakpoint
ALTER TABLE "category_rules" DROP CONSTRAINT "category_rules_financial_profile_id_match_type_pattern_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "category_rules_personal_identity_unique" ON "category_rules" USING btree ("financial_profile_id","match_type","pattern") WHERE "category_rules"."financial_profile_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "category_rules_global_identity_unique" ON "category_rules" USING btree ("match_type","pattern") WHERE "category_rules"."financial_profile_id" IS NULL;--> statement-breakpoint
-- Verification + enforcement in one step: if any duplicate or
-- ownership-invariant violation somehow survived the repair above, this
-- constraint fails to create and the whole migration (one transaction)
-- rolls back rather than silently leaving the invariant unprotected.
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_origin_ownership_check" CHECK (("category_rules"."financial_profile_id" IS NULL AND "category_rules"."origin" = 'SYSTEM_DEFAULT') OR ("category_rules"."financial_profile_id" IS NOT NULL AND "category_rules"."origin" <> 'SYSTEM_DEFAULT'));
