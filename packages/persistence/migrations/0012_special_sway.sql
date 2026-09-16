ALTER TABLE "category_rules" ADD COLUMN "origin" text;--> statement-breakpoint
ALTER TABLE "fixed_expenses" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "recurring_candidates" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "recurring_candidates" ADD CONSTRAINT "recurring_candidates_financial_profile_id_kind_evidence_key_unique" UNIQUE("financial_profile_id","kind","evidence_key");