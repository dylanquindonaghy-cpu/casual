ALTER TABLE "assignments" ADD COLUMN "cancel_asked_by" text;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_cancel_asked_by_check" CHECK ("assignments"."cancel_asked_by" is null or ("assignments"."cancel_asked_by" in ('casual', 'firm', 'client', 'unknown')
        and "assignments"."status" in ('cancelled_worker', 'cancelled_firm')));--> statement-breakpoint
-- P3.4: who asked for each cancellation there is, from its own record: a casual's own
-- (cancelled_worker) the casual; the office's (cancel_via office, or no via on a row from before
-- 12C.1 on a session ShiftDesk or a file made) the firm; a rota sheet's, a file's or a planner's
-- (cancel_via sheet, import or api, or no via on a sheet's or planner's session) not known, as
-- their data doesn't say. Firm by firm, with the firm set as withFirm sets it, so Row Level Security
-- stays on for this owner, and each statement names the firm too (as 0049 does).
DO $$
DECLARE f uuid;
BEGIN
  FOR f IN SELECT id FROM firms ORDER BY id LOOP
    PERFORM set_config('app.current_firm_id', f::text, true);
    UPDATE assignments a
       SET cancel_asked_by = CASE
             WHEN a.status = 'cancelled_worker' THEN 'casual'
             WHEN coalesce(a.cancel_via, CASE s.source WHEN 'sheets' THEN 'sheet'
                                                       WHEN 'api' THEN 'api'
                                                       ELSE 'office' END) = 'office' THEN 'firm'
             ELSE 'unknown'
           END
      FROM shifts s
     WHERE a.firm_id = f AND s.firm_id = a.firm_id AND s.id = a.shift_id
       AND a.status IN ('cancelled_worker', 'cancelled_firm') AND a.cancel_asked_by IS NULL;
  END LOOP;
  PERFORM set_config('app.current_firm_id', '', true);
END $$;
