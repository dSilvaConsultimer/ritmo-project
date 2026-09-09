DROP TABLE "recommendations";--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" text PRIMARY KEY NOT NULL,
	"financial_profile_id" text NOT NULL,
	"type" text NOT NULL,
	"identity_key" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"evidence_normalized_merchant" text NOT NULL,
	"evidence_category" text,
	"evidence_cadence" text NOT NULL,
	"evidence_observed_amount_cents" integer NOT NULL,
	"evidence_monthly_equivalent_amount_cents" integer,
	"evidence_occurrences" integer NOT NULL,
	"evidence_transaction_ids" text NOT NULL,
	"evidence_payment_source_id" text,
	"evidence_confidence" text NOT NULL,
	"projected_monthly_impact_cents" integer NOT NULL,
	"projected_annual_impact_cents" integer NOT NULL,
	"status" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"user_target_amount_cents" integer,
	"effective_date" text,
	"rejection_reason" text,
	"last_verification_assessment" text,
	"last_verification_checked_at" text,
	"decision_history" text NOT NULL,
	"supersedes_recommendation_id" text,
	CONSTRAINT "recommendations_financial_profile_id_identity_key_unique" UNIQUE("financial_profile_id","identity_key")
);
--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_financial_profile_id_financial_profiles_id_fk" FOREIGN KEY ("financial_profile_id") REFERENCES "public"."financial_profiles"("id") ON DELETE no action ON UPDATE no action;
