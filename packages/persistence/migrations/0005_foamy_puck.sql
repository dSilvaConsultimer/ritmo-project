CREATE TABLE "alert_evaluation_checkpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"financial_profile_id" text NOT NULL,
	"safe_to_spend_cents" integer NOT NULL,
	"liquidity_aware_safe_to_spend_cents" integer,
	"liquidity_coverage" text NOT NULL,
	"active_drop_episode_baseline_cents" integer,
	"evaluated_at" text NOT NULL,
	"policy_version" integer NOT NULL,
	CONSTRAINT "alert_evaluation_checkpoints_financial_profile_id_unique" UNIQUE("financial_profile_id")
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"financial_profile_id" text NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"severity" text NOT NULL,
	"identity_key" text NOT NULL,
	"title" text NOT NULL,
	"reason_code" text NOT NULL,
	"created_at" text NOT NULL,
	"first_triggered_at" text NOT NULL,
	"last_triggered_at" text NOT NULL,
	"resolved_at" text,
	"seen_at" text,
	"dismissed_at" text,
	"evidence_json" text NOT NULL,
	"related_entity_type" text,
	"related_entity_id" text,
	"policy_version" integer NOT NULL,
	"transitions_json" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"alert_id" text NOT NULL,
	"financial_profile_id" text NOT NULL,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"attempted_at" text NOT NULL,
	"delivered_at" text,
	"failure_reason_code" text
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" text PRIMARY KEY NOT NULL,
	"financial_profile_id" text NOT NULL,
	"in_app_enabled" boolean DEFAULT true NOT NULL,
	"financial_change_enabled" boolean DEFAULT true NOT NULL,
	"planned_events_enabled" boolean DEFAULT true NOT NULL,
	"recommendations_enabled" boolean DEFAULT true NOT NULL,
	"connection_health_enabled" boolean DEFAULT true NOT NULL,
	"concierge_enabled" boolean DEFAULT true NOT NULL,
	"quiet_hours_start" text,
	"quiet_hours_end" text,
	"privacy_mode" text DEFAULT 'AMOUNT_ALLOWED' NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "notification_preferences_financial_profile_id_unique" UNIQUE("financial_profile_id")
);
--> statement-breakpoint
ALTER TABLE "alert_evaluation_checkpoints" ADD CONSTRAINT "alert_evaluation_checkpoints_financial_profile_id_financial_profiles_id_fk" FOREIGN KEY ("financial_profile_id") REFERENCES "public"."financial_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_financial_profile_id_financial_profiles_id_fk" FOREIGN KEY ("financial_profile_id") REFERENCES "public"."financial_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_financial_profile_id_financial_profiles_id_fk" FOREIGN KEY ("financial_profile_id") REFERENCES "public"."financial_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_financial_profile_id_financial_profiles_id_fk" FOREIGN KEY ("financial_profile_id") REFERENCES "public"."financial_profiles"("id") ON DELETE no action ON UPDATE no action;