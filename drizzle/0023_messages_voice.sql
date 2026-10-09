ALTER TABLE "messages" DROP CONSTRAINT "messages_channel_check";--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_from_e164";--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "from_e164" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_channel_check" CHECK ("messages"."channel" in ('whatsapp', 'sms', 'voice'));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_from_e164" CHECK (("messages"."from_e164" is not null and "messages"."from_e164" ~ '^[+][1-9][0-9]{6,14}$')
        or ("messages"."from_e164" is null and "messages"."channel" = 'voice' and "messages"."direction" = 'in'));