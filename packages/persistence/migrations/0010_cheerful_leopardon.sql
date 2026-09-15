ALTER TABLE "financial_positions" ADD COLUMN "reserved_balance_certainty" text;--> statement-breakpoint
ALTER TABLE "financial_positions" ADD COLUMN "reserved_balance_cents" integer;--> statement-breakpoint
ALTER TABLE "financial_positions" ADD COLUMN "automatically_invested_balance_certainty" text;--> statement-breakpoint
ALTER TABLE "financial_positions" ADD COLUMN "automatically_invested_balance_cents" integer;--> statement-breakpoint
ALTER TABLE "incomes" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "incomes" ADD COLUMN "expected_day_of_month" integer;--> statement-breakpoint
ALTER TABLE "payment_sources" ADD COLUMN "available_balance_cents" integer;--> statement-breakpoint
ALTER TABLE "payment_sources" ADD COLUMN "reserved_balance_cents" integer;--> statement-breakpoint
ALTER TABLE "payment_sources" ADD COLUMN "automatically_invested_balance_cents" integer;