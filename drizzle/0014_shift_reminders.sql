CREATE TABLE "shift_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"channel" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shift_reminders_firm_id_id_key" UNIQUE("firm_id","id"),
	CONSTRAINT "shift_reminders_once_key" UNIQUE("firm_id","assignment_id","kind","starts_at"),
	CONSTRAINT "shift_reminders_kind_check" CHECK ("shift_reminders"."kind" in ('24h', '2h')),
	CONSTRAINT "shift_reminders_status_check" CHECK ("shift_reminders"."status" in ('sending', 'sent', 'failed', 'skipped')),
	CONSTRAINT "shift_reminders_channel_check" CHECK ("shift_reminders"."channel" in ('whatsapp', 'sms')),
	CONSTRAINT "shift_reminders_channel_unless_skipped" CHECK (("shift_reminders"."status" = 'skipped') = ("shift_reminders"."channel" is null))
);
--> statement-breakpoint
ALTER TABLE "shift_reminders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shift_reminders" ADD CONSTRAINT "shift_reminders_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_reminders" ADD CONSTRAINT "shift_reminders_assignment_fk" FOREIGN KEY ("firm_id","assignment_id") REFERENCES "public"."assignments"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "shift_reminders" AS PERMISSIVE FOR ALL TO public USING ("shift_reminders"."firm_id" = (select app_current_firm_id())) WITH CHECK ("shift_reminders"."firm_id" = (select app_current_firm_id()));