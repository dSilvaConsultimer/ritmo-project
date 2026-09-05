CREATE TABLE "ai_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"started_at" text NOT NULL,
	"finished_at" text,
	"latency_ms" integer,
	"tool_call_count" integer DEFAULT 0 NOT NULL,
	"tool_names" text,
	"success" boolean NOT NULL,
	"error_code" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"grounding_status" text,
	"provider_response_id" text
);
--> statement-breakpoint
CREATE TABLE "ai_tool_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"request_message_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"arguments_json" text NOT NULL,
	"status" text NOT NULL,
	"result_summary_json" text,
	"error_category" text,
	"started_at" text NOT NULL,
	"finished_at" text
);
--> statement-breakpoint
CREATE TABLE "conversation_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"financial_profile_id" text NOT NULL,
	"title" text,
	"status" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_tool_executions" ADD CONSTRAINT "ai_tool_executions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_tool_executions" ADD CONSTRAINT "ai_tool_executions_request_message_id_conversation_messages_id_fk" FOREIGN KEY ("request_message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_financial_profile_id_financial_profiles_id_fk" FOREIGN KEY ("financial_profile_id") REFERENCES "public"."financial_profiles"("id") ON DELETE no action ON UPDATE no action;