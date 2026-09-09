CREATE TABLE "concierge_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"financial_profile_id" text NOT NULL,
	"intent_json" text NOT NULL,
	"envelope_recommended_amount_cents" integer NOT NULL,
	"envelope_caution_amount_cents" integer NOT NULL,
	"envelope_as_of_date" text NOT NULL,
	"plans_json" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_concierge_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"financial_profile_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"plan_json" text NOT NULL,
	"status" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "saved_concierge_plans_financial_profile_id_plan_id_unique" UNIQUE("financial_profile_id","plan_id")
);
--> statement-breakpoint
ALTER TABLE "concierge_sessions" ADD CONSTRAINT "concierge_sessions_financial_profile_id_financial_profiles_id_fk" FOREIGN KEY ("financial_profile_id") REFERENCES "public"."financial_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_concierge_plans" ADD CONSTRAINT "saved_concierge_plans_session_id_concierge_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."concierge_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_concierge_plans" ADD CONSTRAINT "saved_concierge_plans_financial_profile_id_financial_profiles_id_fk" FOREIGN KEY ("financial_profile_id") REFERENCES "public"."financial_profiles"("id") ON DELETE no action ON UPDATE no action;