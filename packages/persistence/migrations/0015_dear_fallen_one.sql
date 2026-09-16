ALTER TABLE "categories" DROP CONSTRAINT "categories_name_unique";--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "financial_profile_id" text;--> statement-breakpoint
ALTER TABLE "category_rules" ADD COLUMN "category_id" text;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_financial_profile_id_financial_profiles_id_fk" FOREIGN KEY ("financial_profile_id") REFERENCES "public"."financial_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_personal_name_unique" ON "categories" USING btree ("financial_profile_id","name") WHERE "categories"."financial_profile_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_base_name_unique" ON "categories" USING btree ("name") WHERE "categories"."financial_profile_id" IS NULL;