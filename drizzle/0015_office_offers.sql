ALTER TABLE "offers" ALTER COLUMN "wave" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "offered_by" uuid;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_offered_by_fk" FOREIGN KEY ("firm_id","offered_by") REFERENCES "public"."office_users"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_firm_id_entity_id_idx" ON "events" USING btree ("firm_id","entity_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "offers_one_office_offer_per_worker" ON "offers" USING btree ("firm_id","shift_id","worker_id") WHERE "offers"."wave" is null;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_wave_or_office" CHECK (("offers"."wave" is null) = ("offers"."offered_by" is not null));