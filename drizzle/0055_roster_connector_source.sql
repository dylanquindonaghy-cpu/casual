ALTER TABLE "roster_sources" DROP CONSTRAINT "roster_sources_kind_check";--> statement-breakpoint
ALTER TABLE "roster_sources" ALTER COLUMN "spreadsheet_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "roster_sources" ADD COLUMN "connector" text;--> statement-breakpoint
ALTER TABLE "roster_sources" ADD COLUMN "base_url" text;--> statement-breakpoint
ALTER TABLE "roster_sources" ADD CONSTRAINT "roster_sources_kind_fields" CHECK (case when "roster_sources"."kind" = 'sheets'
            then "roster_sources"."spreadsheet_id" is not null and "roster_sources"."connector" is null and "roster_sources"."base_url" is null
            else "roster_sources"."spreadsheet_id" is null
              and "roster_sources"."connector" is not null and "roster_sources"."base_url" is not null
          end);--> statement-breakpoint
ALTER TABLE "roster_sources" ADD CONSTRAINT "roster_sources_connector_check" CHECK ("roster_sources"."connector" in ('demo_portal'));--> statement-breakpoint
ALTER TABLE "roster_sources" ADD CONSTRAINT "roster_sources_base_url_format" CHECK ("roster_sources"."base_url" ~ '^https://[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?(:[0-9]{1,5})?(/[A-Za-z0-9._~/-]{0,200})?$');--> statement-breakpoint
ALTER TABLE "roster_sources" ADD CONSTRAINT "roster_sources_kind_check" CHECK ("roster_sources"."kind" in ('sheets', 'connector'));