CREATE TABLE "shift_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"name" text NOT NULL,
	"site_id" uuid,
	"source" text DEFAULT 'native' NOT NULL,
	"planner_ref" text,
	"showing_to_casuals" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shift_events_firm_id_id_key" UNIQUE("firm_id","id"),
	CONSTRAINT "shift_events_name_length" CHECK (char_length("shift_events"."name") between 1 and 200),
	CONSTRAINT "shift_events_source_check" CHECK ("shift_events"."source" in ('native', 'sheets', 'csv')),
	CONSTRAINT "shift_events_planner_ref_length" CHECK ("shift_events"."planner_ref" is null or char_length("shift_events"."planner_ref") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "shift_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "shift_events" ADD CONSTRAINT "shift_events_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "shift_events" ADD CONSTRAINT "shift_events_site_fk" FOREIGN KEY ("firm_id","site_id") REFERENCES "public"."sites"("firm_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "shift_events_auto_key" ON "shift_events" USING btree ("firm_id","planner_ref") WHERE "shift_events"."planner_ref" like 'auto:%';
--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "shift_events" AS PERMISSIVE FOR ALL TO public USING ("shift_events"."firm_id" = (select app_current_firm_id())) WITH CHECK ("shift_events"."firm_id" = (select app_current_firm_id()));
--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "event_id" uuid;
--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "pay_rate_pence" integer;
--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "post" text;
--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "meeting_point" text;
--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "uniform" text;
--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "required_credentials" text[] DEFAULT '{}'::text[] NOT NULL;
--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "showing_to_casuals" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
-- Hand-written (12B.1): every existing shift joins an automatic event for its site and its start's
-- firm-local date, named like "Acme Demo Arena · Sat 10 Oct" ("Sat 10 Oct" with no site; a long site
-- name is cut so the name fits 200 characters), found again by its key in planner_ref
-- ("auto:{site id or none}:{yyyy-mm-dd}"); src/lib/roster/shift-events.ts makes the same names and
-- keys for new rows, and tests/integration/db.event-backfill.test.ts holds the two together. The
-- event's source is its earliest shift's. Forced RLS binds the owner on firms' tables, so each firm is
-- set in turn (firms are readable through the owner's directory_read policy); shift_events isn't
-- forced yet (db:migrate forces it afterwards), so every query on it names the firm. The setting is
-- cleared at the end, so a later migration in the same run starts with no firm.
DO $$
DECLARE
  f record;
BEGIN
  FOR f IN SELECT id, timezone FROM public.firms ORDER BY id LOOP
    PERFORM set_config('app.current_firm_id', f.id::text, true);
    INSERT INTO public.shift_events (firm_id, name, site_id, source, planner_ref)
    SELECT DISTINCT ON (g.key) f.id, g.name, g.site_id, g.source, g.key
      FROM (
        SELECT s.site_id, s.source, s.created_at, s.id,
               'auto:' || coalesce(s.site_id::text, 'none') || ':'
                 || to_char((s.starts_at AT TIME ZONE f.timezone)::date, 'YYYY-MM-DD') AS key,
               CASE WHEN si.name IS NULL
                 THEN to_char((s.starts_at AT TIME ZONE f.timezone)::date, 'Dy FMDD Mon')
                 ELSE left(si.name, 187) || ' · '
                   || to_char((s.starts_at AT TIME ZONE f.timezone)::date, 'Dy FMDD Mon')
               END AS name
          FROM public.shifts s
          LEFT JOIN public.sites si ON si.firm_id = s.firm_id AND si.id = s.site_id
         WHERE s.firm_id = f.id AND s.event_id IS NULL
      ) g
     ORDER BY g.key, g.created_at, g.id
    ON CONFLICT (firm_id, planner_ref) WHERE planner_ref LIKE 'auto:%' DO NOTHING;
    UPDATE public.shifts s
       SET event_id = e.id
      FROM public.shift_events e
     WHERE s.firm_id = f.id AND s.event_id IS NULL
       AND e.firm_id = f.id
       AND e.planner_ref = 'auto:' || coalesce(s.site_id::text, 'none') || ':'
         || to_char((s.starts_at AT TIME ZONE f.timezone)::date, 'YYYY-MM-DD');
  END LOOP;
  PERFORM set_config('app.current_firm_id', '', true);
END $$;
--> statement-breakpoint
-- Every shift now has an event; one left without (a firm the loop didn't reach) fails here and the
-- whole migration is rolled back.
ALTER TABLE "shifts" ALTER COLUMN "event_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_event_fk" FOREIGN KEY ("firm_id","event_id") REFERENCES "public"."shift_events"("firm_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_pay_rate_range" CHECK ("shifts"."pay_rate_pence" is null or "shifts"."pay_rate_pence" >= 0);
--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_post_length" CHECK ("shifts"."post" is null or char_length("shifts"."post") between 1 and 200);
--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_meeting_point_length" CHECK ("shifts"."meeting_point" is null or char_length("shifts"."meeting_point") between 1 and 300);
--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_uniform_length" CHECK ("shifts"."uniform" is null or char_length("shifts"."uniform") between 1 and 300);
--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_required_credentials_format" CHECK (coalesce(array_ndims("shifts"."required_credentials"), 1) = 1
    and array_position("shifts"."required_credentials", null) is null
    and (cardinality("shifts"."required_credentials") = 0
      or (array_to_string("shifts"."required_credentials", ',') ~ '^[A-Z][A-Z0-9_]*(,[A-Z][A-Z0-9_]*)*$'
        and cardinality(string_to_array(array_to_string("shifts"."required_credentials", ','), ','))
          = cardinality("shifts"."required_credentials")))
        and cardinality("shifts"."required_credentials") <= 20);
