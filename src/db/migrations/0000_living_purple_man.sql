CREATE TYPE "public"."driver_status" AS ENUM('FINISHED', 'DNF', 'DNS', 'DSQ');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('OVERTAKE', 'PIT_STOP', 'RETIREMENT', 'SAFETY_CAR', 'VIRTUAL_SAFETY_CAR', 'RED_FLAG', 'FASTEST_LAP', 'PENALTY', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."ingest_status" AS ENUM('RUNNING', 'SUCCESS', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."race_type" AS ENUM('GRAND_PRIX', 'SPRINT');--> statement-breakpoint
CREATE TABLE "app_config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"ingest_enabled" boolean DEFAULT true NOT NULL,
	"run_days" text[] DEFAULT '{"mon"}' NOT NULL,
	"active_season" integer NOT NULL,
	"hours_after_race" integer DEFAULT 12 NOT NULL,
	CONSTRAINT "app_config_single_row" CHECK ("app_config"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "driver_team_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_season_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"number" integer,
	"country" text,
	"headshot_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drivers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "ingest_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"target" text,
	"status" "ingest_status" NOT NULL,
	"rows_written" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_year" integer NOT NULL,
	"round" integer NOT NULL,
	"name" text NOT NULL,
	"country" text NOT NULL,
	"circuit_name" text,
	"start_date" timestamp with time zone NOT NULL,
	"weather" jsonb,
	"openf1_meeting_key" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meetings_openf1_meeting_key_unique" UNIQUE("openf1_meeting_key")
);
--> statement-breakpoint
CREATE TABLE "race_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"race_id" uuid NOT NULL,
	"lap" integer NOT NULL,
	"assignment_id" uuid,
	"type" "event_type" NOT NULL,
	"details" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "race_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"race_id" uuid NOT NULL,
	"lap" integer NOT NULL,
	"assignment_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"gap" text,
	"lap_time" real,
	"sector_1" real,
	"sector_2" real,
	"sector_3" real
);
--> statement-breakpoint
CREATE TABLE "race_results" (
	"race_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"grid_position" integer,
	"final_position" integer,
	"status" "driver_status" NOT NULL,
	"laps_completed" integer DEFAULT 0 NOT NULL,
	"points" real DEFAULT 0 NOT NULL,
	"fastest_lap" boolean DEFAULT false NOT NULL,
	CONSTRAINT "race_results_race_id_assignment_id_pk" PRIMARY KEY("race_id","assignment_id")
);
--> statement-breakpoint
CREATE TABLE "races" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"type" "race_type" NOT NULL,
	"slug" text NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"laps" integer NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"openf1_session_key" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "races_slug_unique" UNIQUE("slug"),
	CONSTRAINT "races_openf1_session_key_unique" UNIQUE("openf1_session_key")
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"year" integer PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_year" integer NOT NULL,
	"team_id" uuid NOT NULL,
	"color" text
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"logo_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "driver_team_assignments" ADD CONSTRAINT "driver_team_assignments_team_season_id_team_seasons_id_fk" FOREIGN KEY ("team_season_id") REFERENCES "public"."team_seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_team_assignments" ADD CONSTRAINT "driver_team_assignments_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_season_year_seasons_year_fk" FOREIGN KEY ("season_year") REFERENCES "public"."seasons"("year") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_events" ADD CONSTRAINT "race_events_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_events" ADD CONSTRAINT "race_events_assignment_id_driver_team_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."driver_team_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_positions" ADD CONSTRAINT "race_positions_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_positions" ADD CONSTRAINT "race_positions_assignment_id_driver_team_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."driver_team_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_results" ADD CONSTRAINT "race_results_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_results" ADD CONSTRAINT "race_results_assignment_id_driver_team_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."driver_team_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "races" ADD CONSTRAINT "races_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_seasons" ADD CONSTRAINT "team_seasons_season_year_seasons_year_fk" FOREIGN KEY ("season_year") REFERENCES "public"."seasons"("year") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_seasons" ADD CONSTRAINT "team_seasons_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dta_team_season_driver_uq" ON "driver_team_assignments" USING btree ("team_season_id","driver_id");--> statement-breakpoint
CREATE INDEX "ingest_runs_started_idx" ON "ingest_runs" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "meetings_season_round_uq" ON "meetings" USING btree ("season_year","round");--> statement-breakpoint
CREATE INDEX "race_events_race_lap_idx" ON "race_events" USING btree ("race_id","lap");--> statement-breakpoint
CREATE UNIQUE INDEX "race_positions_lap_driver_uq" ON "race_positions" USING btree ("race_id","lap","assignment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "race_positions_lap_position_uq" ON "race_positions" USING btree ("race_id","lap","position");--> statement-breakpoint
CREATE INDEX "race_positions_race_lap_idx" ON "race_positions" USING btree ("race_id","lap");--> statement-breakpoint
CREATE UNIQUE INDEX "races_meeting_type_uq" ON "races" USING btree ("meeting_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "team_seasons_season_team_uq" ON "team_seasons" USING btree ("season_year","team_id");