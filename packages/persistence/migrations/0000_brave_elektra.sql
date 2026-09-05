CREATE TABLE "categories" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "category_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"match_type" text NOT NULL,
	"pattern" text NOT NULL,
	"category" text NOT NULL,
	"subcategory" text,
	"priority" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_event_line_items" (
	"id" text PRIMARY KEY NOT NULL,
	"financial_event_id" text NOT NULL,
	"label" text NOT NULL,
	"amount_cents" integer,
	"certainty" text NOT NULL,
	"status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_events" (
	"id" text PRIMARY KEY NOT NULL,
	"financial_profile_id" text NOT NULL,
	"label" text NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_goals" (
	"id" text PRIMARY KEY NOT NULL,
	"financial_profile_id" text NOT NULL,
	"label" text NOT NULL,
	"monthly_savings_target_cents" integer NOT NULL,
	"target_reserve_amount_cents" integer
);
--> statement-breakpoint
CREATE TABLE "financial_positions" (
	"id" text PRIMARY KEY NOT NULL,
	"financial_profile_id" text NOT NULL,
	"as_of" text NOT NULL,
	"cash_balance_certainty" text NOT NULL,
	"cash_balance_cents" integer,
	"card_outstanding_certainty" text NOT NULL,
	"card_outstanding_cents" integer,
	"other_liabilities_certainty" text NOT NULL,
	"other_liabilities_cents" integer,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"financial_profile_id" text NOT NULL,
	"external_provider_id" text,
	"external_transaction_id" text,
	"payment_source_id" text NOT NULL,
	"date" text NOT NULL,
	"authorization_date" text,
	"posting_date" text,
	"amount_cents" integer NOT NULL,
	"direction" text NOT NULL,
	"raw_description" text NOT NULL,
	"normalized_description" text NOT NULL,
	"raw_merchant" text,
	"normalized_merchant" text,
	"status" text NOT NULL,
	"certainty" text NOT NULL,
	"financial_effect" text NOT NULL,
	"category" text,
	"subcategory" text,
	"origin" text NOT NULL,
	"metadata" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fixed_expenses" (
	"id" text PRIMARY KEY NOT NULL,
	"financial_profile_id" text NOT NULL,
	"label" text NOT NULL,
	"category" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"certainty" text NOT NULL,
	"protected" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incomes" (
	"id" text PRIMARY KEY NOT NULL,
	"financial_profile_id" text NOT NULL,
	"label" text NOT NULL,
	"gross_amount_cents" integer NOT NULL,
	"certainty" text NOT NULL,
	"recurring" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "installment_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"financial_profile_id" text NOT NULL,
	"description" text NOT NULL,
	"origin_transaction_id" text,
	"total_original_amount_cents" integer,
	"installment_amount_cents" integer NOT NULL,
	"installment_number" integer,
	"total_installments" integer,
	"first_due_date" text,
	"certainty" text NOT NULL,
	"status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lifestyle_deltas" (
	"id" text PRIMARY KEY NOT NULL,
	"lifestyle_scenario_id" text NOT NULL,
	"label" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"certainty" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lifestyle_scenarios" (
	"id" text PRIMARY KEY NOT NULL,
	"financial_profile_id" text NOT NULL,
	"type" text NOT NULL,
	"label" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_normalization_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"match_type" text NOT NULL,
	"pattern" text NOT NULL,
	"normalized_merchant" text NOT NULL,
	"priority" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"financial_profile_id" text NOT NULL,
	"label" text NOT NULL,
	"type" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "protected_preferences" (
	"id" text PRIMARY KEY NOT NULL,
	"financial_profile_id" text NOT NULL,
	"label" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_expense_id" text,
	"scope_category" text,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" text PRIMARY KEY NOT NULL,
	"financial_profile_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"estimated_monthly_savings_cents" integer NOT NULL,
	"status" text NOT NULL,
	"created_at" text NOT NULL,
	"decided_at" text,
	"modified_monthly_savings_cents" integer,
	"rejection_reason" text,
	"verified_at" text,
	"actual_monthly_savings_cents" integer,
	"supersedes_recommendation_id" text
);
--> statement-breakpoint
CREATE TABLE "reconciliation_links" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"primary_transaction_id" text NOT NULL,
	"linked_transaction_id" text,
	"linked_event_line_item_id" text,
	"confidence" text NOT NULL,
	"method" text NOT NULL,
	"status" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"financial_profile_id" text NOT NULL,
	"evidence_key" text NOT NULL,
	"normalized_merchant" text NOT NULL,
	"occurrences" integer NOT NULL,
	"average_amount_cents" integer NOT NULL,
	"average_interval_days" integer,
	"confidence" text NOT NULL,
	"status" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "variable_budgets" (
	"id" text PRIMARY KEY NOT NULL,
	"financial_profile_id" text NOT NULL,
	"label" text NOT NULL,
	"category" text NOT NULL,
	"target_amount_cents" integer NOT NULL,
	"certainty" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "financial_event_line_items" ADD CONSTRAINT "financial_event_line_items_financial_event_id_financial_events_id_fk" FOREIGN KEY ("financial_event_id") REFERENCES "public"."financial_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_events" ADD CONSTRAINT "financial_events_financial_profile_id_financial_profiles_id_fk" FOREIGN KEY ("financial_profile_id") REFERENCES "public"."financial_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_goals" ADD CONSTRAINT "financial_goals_financial_profile_id_financial_profiles_id_fk" FOREIGN KEY ("financial_profile_id") REFERENCES "public"."financial_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_positions" ADD CONSTRAINT "financial_positions_financial_profile_id_financial_profiles_id_fk" FOREIGN KEY ("financial_profile_id") REFERENCES "public"."financial_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_financial_profile_id_financial_profiles_id_fk" FOREIGN KEY ("financial_profile_id") REFERENCES "public"."financial_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_payment_source_id_payment_sources_id_fk" FOREIGN KEY ("payment_source_id") REFERENCES "public"."payment_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_expenses" ADD CONSTRAINT "fixed_expenses_financial_profile_id_financial_profiles_id_fk" FOREIGN KEY ("financial_profile_id") REFERENCES "public"."financial_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_financial_profile_id_financial_profiles_id_fk" FOREIGN KEY ("financial_profile_id") REFERENCES "public"."financial_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_financial_profile_id_financial_profiles_id_fk" FOREIGN KEY ("financial_profile_id") REFERENCES "public"."financial_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_origin_transaction_id_financial_transactions_id_fk" FOREIGN KEY ("origin_transaction_id") REFERENCES "public"."financial_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifestyle_deltas" ADD CONSTRAINT "lifestyle_deltas_lifestyle_scenario_id_lifestyle_scenarios_id_fk" FOREIGN KEY ("lifestyle_scenario_id") REFERENCES "public"."lifestyle_scenarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifestyle_scenarios" ADD CONSTRAINT "lifestyle_scenarios_financial_profile_id_financial_profiles_id_fk" FOREIGN KEY ("financial_profile_id") REFERENCES "public"."financial_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_sources" ADD CONSTRAINT "payment_sources_financial_profile_id_financial_profiles_id_fk" FOREIGN KEY ("financial_profile_id") REFERENCES "public"."financial_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protected_preferences" ADD CONSTRAINT "protected_preferences_financial_profile_id_financial_profiles_id_fk" FOREIGN KEY ("financial_profile_id") REFERENCES "public"."financial_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protected_preferences" ADD CONSTRAINT "protected_preferences_scope_expense_id_fixed_expenses_id_fk" FOREIGN KEY ("scope_expense_id") REFERENCES "public"."fixed_expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_financial_profile_id_financial_profiles_id_fk" FOREIGN KEY ("financial_profile_id") REFERENCES "public"."financial_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_links" ADD CONSTRAINT "reconciliation_links_primary_transaction_id_financial_transactions_id_fk" FOREIGN KEY ("primary_transaction_id") REFERENCES "public"."financial_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_links" ADD CONSTRAINT "reconciliation_links_linked_transaction_id_financial_transactions_id_fk" FOREIGN KEY ("linked_transaction_id") REFERENCES "public"."financial_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_links" ADD CONSTRAINT "reconciliation_links_linked_event_line_item_id_financial_event_line_items_id_fk" FOREIGN KEY ("linked_event_line_item_id") REFERENCES "public"."financial_event_line_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_candidates" ADD CONSTRAINT "recurring_candidates_financial_profile_id_financial_profiles_id_fk" FOREIGN KEY ("financial_profile_id") REFERENCES "public"."financial_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variable_budgets" ADD CONSTRAINT "variable_budgets_financial_profile_id_financial_profiles_id_fk" FOREIGN KEY ("financial_profile_id") REFERENCES "public"."financial_profiles"("id") ON DELETE no action ON UPDATE no action;