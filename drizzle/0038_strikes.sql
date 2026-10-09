CREATE TABLE "strikes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"notice_hours" numeric(8, 2) NOT NULL,
	"threshold_hours" integer NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'live' NOT NULL,
	"review_needed" boolean DEFAULT false NOT NULL,
	"review_reasons" text[] DEFAULT '{}'::text[] NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"withdrawn_by" uuid,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_reason" text,
	"evidence_email_status" text,
	"evidence_email_to" text,
	"evidence_email_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "strikes_firm_id_id_key" UNIQUE("firm_id","id"),
	CONSTRAINT "strikes_one_per_booking" UNIQUE("firm_id","assignment_id"),
	CONSTRAINT "strikes_status_check" CHECK ("strikes"."status" in ('live', 'withdrawn')),
	CONSTRAINT "strikes_review_reasons_check" CHECK ("strikes"."review_reasons" <@ array['unwell', 'family_or_caring']::text[]
        and (not "strikes"."review_needed" or cardinality("strikes"."review_reasons") > 0)),
	CONSTRAINT "strikes_notice_under_threshold" CHECK ("strikes"."threshold_hours" > 0 and "strikes"."notice_hours" < "strikes"."threshold_hours"),
	CONSTRAINT "strikes_expires_after_issue" CHECK ("strikes"."expires_at" > "strikes"."issued_at"),
	CONSTRAINT "strikes_reviewed_together" CHECK (("strikes"."reviewed_by" is null) = ("strikes"."reviewed_at" is null)),
	CONSTRAINT "strikes_withdrawn_together" CHECK (("strikes"."status" = 'withdrawn') = ("strikes"."withdrawn_at" is not null)
        and ("strikes"."withdrawn_at" is null) = ("strikes"."withdrawn_by" is null)
        and ("strikes"."withdrawn_reason" is null or length("strikes"."withdrawn_reason") between 1 and 500)),
	CONSTRAINT "strikes_evidence_status_check" CHECK ("strikes"."evidence_email_status" is null
        or "strikes"."evidence_email_status" in ('pending', 'sent', 'failed', 'not_set_up'))
);
--> statement-breakpoint
ALTER TABLE "strikes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "cancel_via" text;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "strike_warning_version" text;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "strike_warning_shown_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "strikes" ADD CONSTRAINT "strikes_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strikes" ADD CONSTRAINT "strikes_worker_fk" FOREIGN KEY ("firm_id","worker_id") REFERENCES "public"."workers"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strikes" ADD CONSTRAINT "strikes_assignment_fk" FOREIGN KEY ("firm_id","assignment_id") REFERENCES "public"."assignments"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strikes" ADD CONSTRAINT "strikes_shift_fk" FOREIGN KEY ("firm_id","shift_id") REFERENCES "public"."shifts"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strikes" ADD CONSTRAINT "strikes_reviewed_by_fk" FOREIGN KEY ("firm_id","reviewed_by") REFERENCES "public"."office_users"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strikes" ADD CONSTRAINT "strikes_withdrawn_by_fk" FOREIGN KEY ("firm_id","withdrawn_by") REFERENCES "public"."office_users"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "strikes_firm_id_worker_id_idx" ON "strikes" USING btree ("firm_id","worker_id","expires_at");--> statement-breakpoint
CREATE INDEX "strikes_firm_id_issued_at_idx" ON "strikes" USING btree ("firm_id","issued_at");--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_cancel_via_check" CHECK ("assignments"."cancel_via" is null or "assignments"."cancel_via" in ('app', 'office', 'sheet', 'import'));--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_strike_warning" CHECK (("assignments"."strike_warning_version" is null) = ("assignments"."strike_warning_shown_at" is null)
        and ("assignments"."strike_warning_version" is null
             or ("assignments"."status" = 'cancelled_worker' and length("assignments"."strike_warning_version") between 1 and 40)));--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "strikes" AS PERMISSIVE FOR ALL TO public USING ("strikes"."firm_id" = (select app_current_firm_id())) WITH CHECK ("strikes"."firm_id" = (select app_current_firm_id()));--> statement-breakpoint
-- 12C.1 (S4): strike rows are deleted strikes.keep_months after they were issued (default 12; kept
-- between 7 and 72, as src/lib/strikes/settings.ts reads it: never inside the 6-month tribunal
-- limit), and none while the firm's retention.hold_until holds (a dispute). Run as the owner from
-- the nightly retention job: the app role can't delete strikes. Like app_purge_old_messages()
-- (migration 0034), it reads the firm's settings itself, so no caller can shorten them.
CREATE OR REPLACE FUNCTION app_purge_old_strikes()
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_firm uuid := public.app_current_firm_id();
    v_settings jsonb;
    v_months integer := 12;
    v_hold date;
    v_today date;
    v_count integer;
  BEGIN
    IF v_firm IS NULL THEN
      RAISE EXCEPTION 'app_purge_old_strikes needs a firm';
    END IF;
    SELECT f.settings, (now() AT TIME ZONE f.timezone)::date
      INTO v_settings, v_today
      FROM public.firms AS f WHERE f.id = v_firm;
    -- Nested, so the cast only ever sees digits (AND's order isn't guaranteed).
    IF jsonb_typeof(v_settings -> 'strikes' -> 'keep_months') = 'number'
       AND (v_settings -> 'strikes' ->> 'keep_months') ~ '^[0-9]{1,3}$' THEN
      IF (v_settings -> 'strikes' ->> 'keep_months')::integer BETWEEN 7 AND 72 THEN
        v_months := (v_settings -> 'strikes' ->> 'keep_months')::integer;
      END IF;
    END IF;
    IF jsonb_typeof(v_settings -> 'retention' -> 'hold_until') = 'string'
       AND (v_settings -> 'retention' ->> 'hold_until') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      BEGIN
        v_hold := (v_settings -> 'retention' ->> 'hold_until')::date;
      EXCEPTION WHEN others THEN
        v_hold := NULL; -- not a real day: no hold, as the app reads it
      END;
      IF v_hold IS NOT NULL AND v_today <= v_hold THEN
        RETURN 0;
      END IF;
    END IF;
    DELETE FROM public.strikes AS s
     WHERE s.firm_id = v_firm AND s.issued_at < now() - make_interval(months => v_months);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
  END
  $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app_purge_old_strikes() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_purge_old_strikes() TO shiftdesk_app;
