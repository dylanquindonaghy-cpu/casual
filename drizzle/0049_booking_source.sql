ALTER TABLE "assignments" ADD COLUMN "booked_via" text;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_booked_via_check" CHECK ("assignments"."booked_via" is null or "assignments"."booked_via" in ('app', 'office', 'sheet', 'api'));--> statement-breakpoint
-- P2.2: where each booking there is came from, from its own "shift.assigned" line: a casual's own
-- (by worker) is the app's, the rota sheet's (source sheets) the sheet's, and the rest the
-- office's, as is a booking with no line (src/lib/strikes/issue.ts counts one so). Firm by firm,
-- with the firm set as withFirm sets it, so Row Level Security stays on for this owner (FORCE ROW
-- LEVEL SECURITY), and each statement names the firm too (as 0043 and 0044 do), so it stays
-- scoped even for an owner that bypasses RLS. Open slots stay empty.
DO $$
DECLARE f uuid;
BEGIN
  FOR f IN SELECT id FROM firms ORDER BY id LOOP
    PERFORM set_config('app.current_firm_id', f::text, true);
    UPDATE assignments a
       SET booked_via = CASE
             WHEN e.data ->> 'by' = 'worker' THEN 'app'
             WHEN e.data ->> 'source' = 'sheets' THEN 'sheet'
             ELSE 'office'
           END
      FROM (SELECT DISTINCT ON (entity_id) entity_id, firm_id, data
              FROM events
             WHERE firm_id = f AND action = 'shift.assigned' AND entity_type = 'assignment'
             ORDER BY entity_id, id DESC) e
     WHERE a.firm_id = f AND e.firm_id = a.firm_id AND a.id = e.entity_id
       AND a.worker_id IS NOT NULL AND a.booked_via IS NULL;
    UPDATE assignments SET booked_via = 'office'
     WHERE firm_id = f AND worker_id IS NOT NULL AND booked_via IS NULL;
  END LOOP;
  PERFORM set_config('app.current_firm_id', '', true);
END $$;
