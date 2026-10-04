CREATE TABLE "race_predictions" (
	"race_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"win_probability" real NOT NULL,
	"model_version" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "race_predictions_race_id_driver_id_model_version_pk" PRIMARY KEY("race_id","driver_id","model_version")
);
--> statement-breakpoint
ALTER TABLE "race_predictions" ADD CONSTRAINT "race_predictions_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_predictions" ADD CONSTRAINT "race_predictions_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;