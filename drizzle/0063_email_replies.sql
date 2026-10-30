CREATE TABLE "email_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"inbound_email_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"template" text,
	"sent_by" uuid,
	"from_draft" boolean DEFAULT false NOT NULL,
	"to_address" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_replies_firm_id_id_key" UNIQUE("firm_id","id"),
	CONSTRAINT "email_replies_kind_check" CHECK ("email_replies"."kind" in ('automatic', 'office')),
	CONSTRAINT "email_replies_template_check" CHECK ("email_replies"."template" in ('shifts', 'cancel', 'pay')),
	CONSTRAINT "email_replies_kind_fields" CHECK (case when "email_replies"."kind" = 'automatic'
            then "email_replies"."template" is not null and "email_replies"."sent_by" is null and not "email_replies"."from_draft"
            else "email_replies"."template" is null and "email_replies"."sent_by" is not null
          end),
	CONSTRAINT "email_replies_to_format" CHECK ("email_replies"."to_address" ~ '^[a-z0-9.!#$%&*+/=?^_`{|}~-]{1,64}@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' and char_length("email_replies"."to_address") <= 254),
	CONSTRAINT "email_replies_subject_length" CHECK (char_length("email_replies"."subject") between 1 and 200),
	CONSTRAINT "email_replies_body_length" CHECK (char_length("email_replies"."body") between 1 and 4000)
);
--> statement-breakpoint
ALTER TABLE "email_replies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD COLUMN "draft_reply" text;--> statement-breakpoint
ALTER TABLE "email_replies" ADD CONSTRAINT "email_replies_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_replies" ADD CONSTRAINT "email_replies_email_fk" FOREIGN KEY ("firm_id","inbound_email_id") REFERENCES "public"."inbound_emails"("firm_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_replies" ADD CONSTRAINT "email_replies_worker_fk" FOREIGN KEY ("firm_id","worker_id") REFERENCES "public"."workers"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_replies" ADD CONSTRAINT "email_replies_sent_by_fk" FOREIGN KEY ("firm_id","sent_by") REFERENCES "public"."office_users"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_replies_firm_id_inbound_email_id_idx" ON "email_replies" USING btree ("firm_id","inbound_email_id");--> statement-breakpoint
CREATE INDEX "email_replies_firm_id_worker_id_idx" ON "email_replies" USING btree ("firm_id","worker_id");--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_draft_reply_known" CHECK ("inbound_emails"."draft_reply" is null or ("inbound_emails"."worker_id" is not null and "inbound_emails"."handled_at" is not null
          and "inbound_emails"."intent" is distinct from 'pay'));--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_draft_reply_length" CHECK (char_length("inbound_emails"."draft_reply") between 1 and 1200);--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "email_replies" AS PERMISSIVE FOR ALL TO public USING ("email_replies"."firm_id" = (select app_current_firm_id())) WITH CHECK ("email_replies"."firm_id" = (select app_current_firm_id()));