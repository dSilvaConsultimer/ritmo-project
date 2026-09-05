CREATE TABLE "bills" (
	"id" text PRIMARY KEY NOT NULL,
	"financial_profile_id" text NOT NULL,
	"payment_source_id" text NOT NULL,
	"provider" text,
	"external_bill_id" text,
	"due_date" text NOT NULL,
	"closing_date" text,
	"total_amount_cents" integer NOT NULL,
	"minimum_payment_cents" integer,
	"allows_installments" boolean,
	"certainty" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"financial_profile_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_connection_id" text NOT NULL,
	"status" text NOT NULL,
	"connector_id" text,
	"connector_name" text,
	"last_successful_sync_at" text,
	"last_attempted_sync_at" text,
	"error_code" text,
	"error_message" text,
	"consent_expires_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "provider_connections_financial_profile_id_provider_external_connection_id_unique" UNIQUE("financial_profile_id","provider","external_connection_id")
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"status" text NOT NULL,
	"started_at" text NOT NULL,
	"finished_at" text,
	"accounts_discovered" integer DEFAULT 0 NOT NULL,
	"transactions_received" integer DEFAULT 0 NOT NULL,
	"transactions_created" integer DEFAULT 0 NOT NULL,
	"transactions_updated" integer DEFAULT 0 NOT NULL,
	"transactions_reconciled" integer DEFAULT 0 NOT NULL,
	"transactions_ignored_duplicates" integer DEFAULT 0 NOT NULL,
	"bills_received" integer DEFAULT 0 NOT NULL,
	"errors" text,
	"provider_cursor" text
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"event" text NOT NULL,
	"received_at" text NOT NULL,
	"processed_at" text,
	"status" text NOT NULL,
	"payload_summary" text,
	"error_message" text
);
--> statement-breakpoint
ALTER TABLE "financial_positions" ADD COLUMN "coverage" text NOT NULL;--> statement-breakpoint
ALTER TABLE "installment_plans" ADD COLUMN "payment_source_id" text;--> statement-breakpoint
ALTER TABLE "payment_sources" ADD COLUMN "subtype" text;--> statement-breakpoint
ALTER TABLE "payment_sources" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "payment_sources" ADD COLUMN "external_account_id" text;--> statement-breakpoint
ALTER TABLE "payment_sources" ADD COLUMN "connection_id" text;--> statement-breakpoint
ALTER TABLE "payment_sources" ADD COLUMN "currency" text;--> statement-breakpoint
ALTER TABLE "payment_sources" ADD COLUMN "balance_certainty" text;--> statement-breakpoint
ALTER TABLE "payment_sources" ADD COLUMN "balance_cents" integer;--> statement-breakpoint
ALTER TABLE "payment_sources" ADD COLUMN "credit_limit_cents" integer;--> statement-breakpoint
ALTER TABLE "payment_sources" ADD COLUMN "available_credit_limit_cents" integer;--> statement-breakpoint
ALTER TABLE "payment_sources" ADD COLUMN "credit_closing_date" text;--> statement-breakpoint
ALTER TABLE "payment_sources" ADD COLUMN "credit_due_date" text;--> statement-breakpoint
ALTER TABLE "payment_sources" ADD COLUMN "minimum_payment_cents" integer;--> statement-breakpoint
ALTER TABLE "payment_sources" ADD COLUMN "last_synced_at" text;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_financial_profile_id_financial_profiles_id_fk" FOREIGN KEY ("financial_profile_id") REFERENCES "public"."financial_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_payment_source_id_payment_sources_id_fk" FOREIGN KEY ("payment_source_id") REFERENCES "public"."payment_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_financial_profile_id_financial_profiles_id_fk" FOREIGN KEY ("financial_profile_id") REFERENCES "public"."financial_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_connection_id_provider_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_payment_source_id_payment_sources_id_fk" FOREIGN KEY ("payment_source_id") REFERENCES "public"."payment_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_sources" ADD CONSTRAINT "payment_sources_connection_id_provider_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE no action ON UPDATE no action;