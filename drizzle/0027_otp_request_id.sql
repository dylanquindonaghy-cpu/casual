ALTER TABLE "otp_codes" ADD COLUMN "request_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "otp_codes_request_key" ON "otp_codes" USING btree ("firm_id","request_id");