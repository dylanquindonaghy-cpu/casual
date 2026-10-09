CREATE INDEX "messages_firm_id_from_e164_idx" ON "messages" USING btree ("firm_id","from_e164");--> statement-breakpoint
CREATE INDEX "credentials_firm_id_worker_id_idx" ON "credentials" USING btree ("firm_id","worker_id");--> statement-breakpoint
CREATE INDEX "push_subscriptions_firm_id_worker_id_idx" ON "push_subscriptions" USING btree ("firm_id","worker_id");