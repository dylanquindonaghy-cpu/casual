ALTER TABLE "firms" ADD COLUMN "shifts_line_e164" text;--> statement-breakpoint
ALTER TABLE "firms" ADD CONSTRAINT "firms_shifts_line_e164_unique" UNIQUE("shifts_line_e164");--> statement-breakpoint
ALTER TABLE "firms" ADD CONSTRAINT "firms_shifts_line_e164" CHECK ("firms"."shifts_line_e164" ~ '^[+][1-9][0-9]{6,14}$');