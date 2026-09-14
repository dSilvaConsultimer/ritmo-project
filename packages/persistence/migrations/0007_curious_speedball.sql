ALTER TABLE "reconciliation_links" ADD COLUMN "financial_profile_id" text;--> statement-breakpoint
UPDATE "reconciliation_links" AS rl
SET "financial_profile_id" = ft."financial_profile_id"
FROM "financial_transactions" AS ft
WHERE ft."id" = rl."primary_transaction_id" AND rl."financial_profile_id" IS NULL;--> statement-breakpoint
ALTER TABLE "reconciliation_links" ALTER COLUMN "financial_profile_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reconciliation_links" ADD CONSTRAINT "reconciliation_links_financial_profile_id_financial_profiles_id_fk" FOREIGN KEY ("financial_profile_id") REFERENCES "public"."financial_profiles"("id") ON DELETE no action ON UPDATE no action;
