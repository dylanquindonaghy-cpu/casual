ALTER TABLE "credential_types" ADD COLUMN "office_recorded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Hand-written (12F.2): the types the packs already say only the office records (src/lib/rules/
-- packs.ts `officeRecorded`: right to work, CSAS, drugs and alcohol tests, rail medicals, DBS) are
-- marked so for every firm that has them. New firms get it from applyCredentialPack. Forced RLS
-- binds the owner on firms' tables, so each firm is set in turn (as 0035 does), and the setting is
-- cleared at the end.
DO $$
DECLARE
  f record;
BEGIN
  FOR f IN SELECT id FROM public.firms ORDER BY id LOOP
    PERFORM set_config('app.current_firm_id', f.id::text, true);
    UPDATE public.credential_types
       SET office_recorded = true
     WHERE firm_id = f.id AND code IN ('RTW', 'CSAS', 'RAIL_DA', 'RAIL_MEDICAL', 'DBS');
  END LOOP;
  PERFORM set_config('app.current_firm_id', '', true);
END $$;
