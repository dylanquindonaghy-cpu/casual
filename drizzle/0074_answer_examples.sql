-- Phase 35 (the guardrails review of the answer library, H1): an answer's example question may not
-- hold a word that always reaches a person or the built-in replies (office, talk, help, the cancel
-- and dropout words, STOP and START: src/lib/inbound/keywords.ts). The Office hours starter's
-- "what time is the office open" held "office", so it could never match; it becomes "what time do
-- you open", for each firm whose Office hours examples are still the starter's own (one an admin
-- has changed is left as it is). Forced RLS binds the owner on firms' tables, so each firm is set
-- in turn (as 0073 does), and the setting is cleared at the end.
DO $$
DECLARE
  f record;
BEGIN
  FOR f IN SELECT id FROM public.firms ORDER BY id LOOP
    PERFORM set_config('app.current_firm_id', f.id::text, true);
    UPDATE public.answers
       SET examples = E'is anyone in\nwhat time do you open'
     WHERE firm_id = f.id AND starter_key = 'office_hours'
       AND examples = E'is anyone in\nwhat time is the office open';
  END LOOP;
  PERFORM set_config('app.current_firm_id', '', true);
END $$;
