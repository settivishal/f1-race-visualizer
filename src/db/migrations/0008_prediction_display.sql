ALTER TABLE "app_config" ADD COLUMN "predictions_shown" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_config" ADD COLUMN "predictions_expanded" integer DEFAULT 10 NOT NULL;