CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"channel" text NOT NULL,
	"provider_message_id" text NOT NULL,
	"worker_id" uuid,
	"from_e164" text NOT NULL,
	"to_e164" text NOT NULL,
	"body" text,
	"handled_as" text,
	"intent" text,
	"handled_at" timestamp with time zone,
	"reply_to" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_firm_id_id_key" UNIQUE("firm_id","id"),
	CONSTRAINT "messages_firm_id_provider_message_id_key" UNIQUE("firm_id","provider_message_id"),
	CONSTRAINT "messages_direction_check" CHECK ("messages"."direction" in ('in', 'out')),
	CONSTRAINT "messages_channel_check" CHECK ("messages"."channel" in ('whatsapp', 'sms')),
	CONSTRAINT "messages_handled_as_check" CHECK ("messages"."handled_as" in ('keyword', 'ai', 'office', 'unknown')),
	CONSTRAINT "messages_intent_check" CHECK ("messages"."intent" in ('shifts', 'cancel', 'pay', 'office')),
	CONSTRAINT "messages_from_e164" CHECK ("messages"."from_e164" ~ '^[+][1-9][0-9]{6,14}$'),
	CONSTRAINT "messages_to_e164" CHECK ("messages"."to_e164" ~ '^[+][1-9][0-9]{6,14}$'),
	CONSTRAINT "messages_body_length" CHECK ("messages"."body" is null or char_length("messages"."body") <= 1600),
	CONSTRAINT "messages_direction_fields" CHECK (("messages"."direction" = 'in' and "messages"."reply_to" is null)
        or ("messages"."direction" = 'out' and "messages"."handled_as" is null and "messages"."handled_at" is null))
);
--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_worker_fk" FOREIGN KEY ("firm_id","worker_id") REFERENCES "public"."workers"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_reply_to_fk" FOREIGN KEY ("firm_id","reply_to") REFERENCES "public"."messages"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_firm_id_created_at_idx" ON "messages" USING btree ("firm_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_firm_id_worker_id_idx" ON "messages" USING btree ("firm_id","worker_id");--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "messages" AS PERMISSIVE FOR ALL TO public USING ("messages"."firm_id" = (select app_current_firm_id())) WITH CHECK ("messages"."firm_id" = (select app_current_firm_id()));