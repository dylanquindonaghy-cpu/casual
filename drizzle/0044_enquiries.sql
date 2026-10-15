ALTER TABLE "requests" ADD COLUMN "message_id" uuid;--> statement-breakpoint
-- Hand-written (12D.1, S5): ON DELETE SET NULL ("message_id") clears the link only. Drizzle writes
-- a bare SET NULL, which would clear firm_id too (NOT NULL), so deleting an old message (the
-- 90-day purge, app_purge_old_messages(); an erasure) would fail. The question stays as evidence.
ALTER TABLE "requests" ADD CONSTRAINT "requests_message_fk" FOREIGN KEY ("firm_id","message_id") REFERENCES "public"."messages"("firm_id","id") ON DELETE SET NULL ("message_id") ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_firm_id_reply_to_idx" ON "messages" USING btree ("firm_id","reply_to");--> statement-breakpoint
CREATE UNIQUE INDEX "requests_one_per_message" ON "requests" USING btree ("firm_id","message_id") WHERE message_id is not null;--> statement-breakpoint
-- Hand-written (12D.1): the shifts line kept a question's message id in its payload
-- (payload.messageId, src/lib/inbound/reply.ts). It moves to the new column when the message is
-- still there (compared as text, so a malformed value is never cast), and leaves the payload either
-- way. Forced RLS binds the owner on firms' tables, so each firm is set in turn (as 0043 does), and
-- the setting is cleared at the end.
DO $$
DECLARE
  f record;
BEGIN
  FOR f IN SELECT id FROM public.firms ORDER BY id LOOP
    PERFORM set_config('app.current_firm_id', f.id::text, true);
    UPDATE public.requests AS r
       SET message_id = m.id
      FROM public.messages AS m
     WHERE r.firm_id = f.id AND m.firm_id = f.id
       AND r.type = 'general' AND r.payload ? 'messageId'
       AND m.id::text = r.payload ->> 'messageId'
       AND m.direction = 'in';
    UPDATE public.requests
       SET payload = payload - 'messageId'
     WHERE firm_id = f.id AND payload ? 'messageId';
  END LOOP;
  PERFORM set_config('app.current_firm_id', '', true);
END $$;
