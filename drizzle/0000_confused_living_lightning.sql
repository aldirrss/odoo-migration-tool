CREATE TABLE "extraction_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_profile_id" text NOT NULL,
	"target_profile_id" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"total_tables" integer DEFAULT 0 NOT NULL,
	"total_records" integer DEFAULT 0 NOT NULL,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"extraction_job_id" integer NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"total_records" integer DEFAULT 0 NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "staged_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"extraction_job_id" integer NOT NULL,
	"table_name" text NOT NULL,
	"source_id" integer NOT NULL,
	"source_data" jsonb NOT NULL,
	"staged_data" jsonb NOT NULL,
	"is_dirty" boolean DEFAULT false NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"validation_status" text DEFAULT 'pending' NOT NULL,
	"validation_messages" jsonb,
	"import_status" text DEFAULT 'pending' NOT NULL,
	"import_error" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "table_extraction_status" (
	"id" serial PRIMARY KEY NOT NULL,
	"extraction_job_id" integer NOT NULL,
	"table_name" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"record_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" timestamp,
	"finished_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_extraction_job_id_extraction_jobs_id_fk" FOREIGN KEY ("extraction_job_id") REFERENCES "public"."extraction_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staged_records" ADD CONSTRAINT "staged_records_extraction_job_id_extraction_jobs_id_fk" FOREIGN KEY ("extraction_job_id") REFERENCES "public"."extraction_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_extraction_status" ADD CONSTRAINT "table_extraction_status_extraction_job_id_extraction_jobs_id_fk" FOREIGN KEY ("extraction_job_id") REFERENCES "public"."extraction_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staged_records_job_table_source_uq" ON "staged_records" USING btree ("extraction_job_id","table_name","source_id");--> statement-breakpoint
CREATE INDEX "staged_records_table_name_idx" ON "staged_records" USING btree ("table_name");--> statement-breakpoint
CREATE INDEX "staged_records_dirty_idx" ON "staged_records" USING btree ("is_dirty");