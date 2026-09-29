ALTER TABLE "requests" ADD COLUMN "resolution_note" text;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_resolution_note" CHECK ("requests"."resolution_note" is null
        or ("requests"."status" in ('approved', 'declined') and char_length("requests"."resolution_note") between 1 and 500));