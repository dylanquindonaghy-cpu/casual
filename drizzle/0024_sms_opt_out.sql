ALTER TABLE "messages" DROP CONSTRAINT "messages_handled_as_check";--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "twilio_opt_out" text;--> statement-breakpoint
ALTER TABLE "workers" ADD COLUMN "sms_opted_out_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_twilio_opt_out" CHECK ("messages"."twilio_opt_out" is null
        or ("messages"."twilio_opt_out" in ('stop', 'start') and "messages"."channel" = 'sms' and "messages"."direction" = 'in'));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_handled_as_check" CHECK ("messages"."handled_as" in ('keyword', 'ai', 'office', 'unknown', 'opt_out'));