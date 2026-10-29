ALTER TABLE "offers" DROP CONSTRAINT "offers_channel_check";--> statement-breakpoint
ALTER TABLE "shift_reminders" DROP CONSTRAINT "shift_reminders_channel_check";--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_channel_check" CHECK ("offers"."channel" in ('push', 'whatsapp', 'sms', 'email'));--> statement-breakpoint
ALTER TABLE "shift_reminders" ADD CONSTRAINT "shift_reminders_channel_check" CHECK ("shift_reminders"."channel" in ('whatsapp', 'sms', 'push', 'email'));