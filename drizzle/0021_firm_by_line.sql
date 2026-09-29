-- Incoming message -> firm (Phase 7, the shifts line). A WhatsApp, text or call arrives addressed
-- to a firm's own number before anything knows the firm, and the app role can't read firms
-- without one set. Like app_resolve_firm() (0003) for a web host, this runs as the table owner and
-- returns only public directory fields, for the one firm whose shifts line is exactly that number.
-- Static SQL only, pinned search_path, qualified names.
CREATE FUNCTION app_firm_by_line(p_number text)
  RETURNS TABLE (id uuid, slug text, name text, timezone text, sign_off text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT f.id, f.slug, f.name, f.timezone, f.settings ->> 'sign_off'
    FROM public.firms AS f
    WHERE f.shifts_line_e164 = p_number
  $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app_firm_by_line(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_firm_by_line(text) TO shiftdesk_app;
