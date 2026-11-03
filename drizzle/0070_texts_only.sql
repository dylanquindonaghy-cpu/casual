-- Hand-written (Phase 26.9; decision 4; Phase 15's "Texts only"): no message to a casual goes by
-- WhatsApp. A casual's choice is a text (the default) or an email; everyone who had chosen WhatsApp
-- gets texts. Forced RLS binds the owner on firms' tables, so each firm is set in turn (as
-- 0035_event_sessions.sql does) and the setting is cleared at the end. A row the loop didn't reach
-- fails the new check below, and the whole migration is rolled back.
ALTER TABLE "workers" DROP CONSTRAINT "workers_notify_channel_check";--> statement-breakpoint
DO $$
DECLARE
  f record;
BEGIN
  FOR f IN SELECT id FROM public.firms ORDER BY id LOOP
    PERFORM set_config('app.current_firm_id', f.id::text, true);
    UPDATE public.workers SET notify_channel = 'sms'
     WHERE firm_id = f.id AND notify_channel = 'whatsapp';
  END LOOP;
  PERFORM set_config('app.current_firm_id', '', true);
END $$;
--> statement-breakpoint
ALTER TABLE "workers" ALTER COLUMN "notify_channel" SET DEFAULT 'sms';--> statement-breakpoint
ALTER TABLE "workers" ADD CONSTRAINT "workers_notify_channel_check" CHECK ("workers"."notify_channel" in ('sms', 'email'));
