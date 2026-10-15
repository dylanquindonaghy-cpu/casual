CREATE TABLE "uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"credential_type" text,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"data" "bytea" NOT NULL,
	"uploaded_by" text DEFAULT 'casual' NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"checked_by" uuid,
	"checked_at" timestamp with time zone,
	"reject_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uploads_firm_id_id_key" UNIQUE("firm_id","id"),
	CONSTRAINT "uploads_kind_check" CHECK ("uploads"."kind" in ('photo', 'certificate')),
	CONSTRAINT "uploads_type_check" CHECK (("uploads"."kind" = 'photo' and "uploads"."credential_type" is null)
        or ("uploads"."kind" = 'certificate' and "uploads"."credential_type" ~ '^[A-Z][A-Z0-9_]*$')),
	CONSTRAINT "uploads_content_type_check" CHECK ("uploads"."content_type" = 'image/jpeg'),
	CONSTRAINT "uploads_size_check" CHECK ("uploads"."size" = octet_length("uploads"."data") and "uploads"."size" between 1 and 1000000),
	CONSTRAINT "uploads_sha256_check" CHECK ("uploads"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "uploads_uploaded_by_check" CHECK ("uploads"."uploaded_by" = 'casual'),
	CONSTRAINT "uploads_status_check" CHECK ("uploads"."status" in ('waiting', 'approved', 'rejected')),
	CONSTRAINT "uploads_checked" CHECK (("uploads"."status" = 'waiting') = ("uploads"."checked_at" is null)
        and ("uploads"."status" = 'waiting') = ("uploads"."checked_by" is null)
        and ("uploads"."status" = 'rejected') = ("uploads"."reject_reason" is not null)
        and ("uploads"."reject_reason" is null or "uploads"."reject_reason" in ('blurry', 'wrong_document', 'expired', 'doesnt_match', 'other')))
);
--> statement-breakpoint
ALTER TABLE "uploads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "credentials" ADD COLUMN "check_state" text DEFAULT 'verified' NOT NULL;--> statement-breakpoint
ALTER TABLE "credentials" ADD COLUMN "rejected_reason" text;--> statement-breakpoint
ALTER TABLE "credentials" ADD COLUMN "evidence_upload_id" uuid;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_worker_fk" FOREIGN KEY ("firm_id","worker_id") REFERENCES "public"."workers"("firm_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_checked_by_fk" FOREIGN KEY ("firm_id","checked_by") REFERENCES "public"."office_users"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uploads_one_waiting" ON "uploads" USING btree ("firm_id","worker_id","kind",coalesce("credential_type", '')) WHERE "uploads"."status" = 'waiting';--> statement-breakpoint
CREATE INDEX "uploads_firm_id_status_idx" ON "uploads" USING btree ("firm_id","status","created_at");--> statement-breakpoint
CREATE INDEX "uploads_firm_id_worker_idx" ON "uploads" USING btree ("firm_id","worker_id","kind","created_at");--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_evidence_upload_fk" FOREIGN KEY ("firm_id","evidence_upload_id") REFERENCES "public"."uploads"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_check_state_check" CHECK ("credentials"."check_state" in ('verified', 'waiting', 'rejected')
        and ("credentials"."check_state" = 'rejected') = ("credentials"."rejected_reason" is not null)
        and ("credentials"."rejected_reason" is null or "credentials"."rejected_reason" in ('blurry', 'wrong_document', 'expired', 'doesnt_match', 'other')));--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_unchecked_never_valid" CHECK ("credentials"."check_state" = 'verified'
        or ("credentials"."status" = 'expired' and "credentials"."evidence_upload_id" is not null));--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "uploads" AS PERMISSIVE FOR ALL TO public USING ("uploads"."firm_id" = (select app_current_firm_id())) WITH CHECK ("uploads"."firm_id" = (select app_current_firm_id()));