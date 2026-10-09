ALTER TABLE "workers" ALTER COLUMN "mobile_e164" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workers" ADD COLUMN "erased_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workers" ADD CONSTRAINT "workers_erased" CHECK (("workers"."erased_at" is null and "workers"."mobile_e164" is not null)
        or ("workers"."erased_at" is not null and "workers"."mobile_e164" is null and "workers"."email" is null
          and "workers"."external_ref" is null and "workers"."first_name" = 'Deleted' and "workers"."last_name" = 'worker'
          and "workers"."status" = 'inactive' and "workers"."roles" = '{}' and "workers"."sms_opted_out_at" is null));--> statement-breakpoint
-- GDPR erasure (Phase 8, src/lib/gdpr/worker-erase.ts). The app role may not delete messages (what
-- a worker asked and what they were told), so the erasure's database half runs as the table
-- owner, whom forced RLS still binds to the current firm. For one worker of this firm not yet
-- erased: it reads their number (the row locked), makes the row "Deleted worker" (the
-- workers_erased check holds it to exactly that), and deletes their messages: the ones set to
-- them, the ones from or to that number with no worker set (sent before the number was known),
-- and the replies to any of those. The number is the one the row held, so no caller can point it
-- at anyone else's messages, and it can run once per worker. Returns how many messages it deleted.
-- Static SQL only, pinned search_path, qualified names.
CREATE FUNCTION app_erase_worker(p_worker uuid)
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_firm uuid := public.app_current_firm_id();
    v_mobile text;
    v_count integer;
  BEGIN
    IF v_firm IS NULL THEN
      RAISE EXCEPTION 'app_erase_worker needs a firm';
    END IF;
    SELECT w.mobile_e164 INTO v_mobile FROM public.workers AS w
     WHERE w.firm_id = v_firm AND w.id = p_worker AND w.erased_at IS NULL
       FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'no worker to erase';
    END IF;
    UPDATE public.workers AS w
       SET first_name = 'Deleted', last_name = 'worker', mobile_e164 = NULL, email = NULL,
           external_ref = NULL, roles = '{}', status = 'inactive', offer_alerts = false,
           sms_opted_out_at = NULL, erased_at = now()
     WHERE w.firm_id = v_firm AND w.id = p_worker;
    WITH theirs AS (
      SELECT m.id FROM public.messages AS m
       WHERE m.firm_id = v_firm
         AND (m.worker_id = p_worker
              OR (m.worker_id IS NULL
                  AND ((m.direction = 'in' AND m.from_e164 = v_mobile)
                       OR (m.direction = 'out' AND m.to_e164 = v_mobile))))
    )
    DELETE FROM public.messages AS m
     WHERE m.firm_id = v_firm
       AND (m.id IN (SELECT t.id FROM theirs AS t) OR m.reply_to IN (SELECT t.id FROM theirs AS t));
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
  END
  $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app_erase_worker(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_erase_worker(uuid) TO shiftdesk_app;
--> statement-breakpoint
-- The retention purge (Phase 8, src/lib/gdpr/retention.ts; docs/compliance.md): the current firm's
-- shifts-line messages more than 90 days old, and any reply to one. The age is fixed here, not
-- passed in, so no caller can make it delete newer messages. Returns how many it deleted.
CREATE FUNCTION app_purge_old_messages()
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_firm uuid := public.app_current_firm_id();
    v_count integer;
  BEGIN
    IF v_firm IS NULL THEN
      RAISE EXCEPTION 'app_purge_old_messages needs a firm';
    END IF;
    WITH old AS (
      SELECT m.id FROM public.messages AS m
       WHERE m.firm_id = v_firm AND m.created_at < now() - interval '90 days'
    )
    DELETE FROM public.messages AS m
     WHERE m.firm_id = v_firm
       AND (m.id IN (SELECT o.id FROM old AS o) OR m.reply_to IN (SELECT o.id FROM old AS o));
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
  END
  $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app_purge_old_messages() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_purge_old_messages() TO shiftdesk_app;
