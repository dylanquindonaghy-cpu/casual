CREATE INDEX "events_firm_id_action_created_at_idx" ON "events" USING btree ("firm_id","action","created_at");--> statement-breakpoint
CREATE INDEX "assignments_firm_id_cancelled_at_idx" ON "assignments" USING btree ("firm_id","cancelled_at");--> statement-breakpoint
CREATE INDEX "offers_firm_id_sent_at_idx" ON "offers" USING btree ("firm_id","sent_at");--> statement-breakpoint
CREATE INDEX "shifts_firm_id_event_id_idx" ON "shifts" USING btree ("firm_id","event_id");--> statement-breakpoint
CREATE INDEX "shifts_firm_id_ends_at_idx" ON "shifts" USING btree ("firm_id","ends_at");