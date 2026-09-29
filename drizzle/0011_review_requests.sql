ALTER TABLE "requests" DROP CONSTRAINT "requests_type_check";--> statement-breakpoint
ALTER TABLE "requests" DROP CONSTRAINT "requests_shift_required";--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_type_check" CHECK ("requests"."type" in ('time_change', 'swap', 'availability', 'general', 'review'));--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_shift_required" CHECK ("requests"."type" not in ('time_change', 'swap', 'review') or "requests"."shift_id" is not null);