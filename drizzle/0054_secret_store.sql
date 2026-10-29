-- P5.1 (ADR-026): the secret store. firm_secrets holds a firm's own credentials, each sealed with
-- AES-256-GCM under a key the database never sees (src/lib/secret-store/crypto.ts). The app role
-- gets no rights on it (src/lib/db/admin/access.ts); the owner writes it (npm run firm:secret).
CREATE TABLE "firm_secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"name" text NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"nonce" "bytea" NOT NULL,
	"key_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "firm_secrets_firm_id_id_key" UNIQUE("firm_id","id"),
	CONSTRAINT "firm_secrets_name_key" UNIQUE("firm_id","name"),
	CONSTRAINT "firm_secrets_name_format" CHECK ("firm_secrets"."name" ~ '^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*){0,3}$'
      and char_length("firm_secrets"."name") <= 64),
	CONSTRAINT "firm_secrets_nonce_length" CHECK (octet_length("firm_secrets"."nonce") = 12),
	CONSTRAINT "firm_secrets_ciphertext_length" CHECK (octet_length("firm_secrets"."ciphertext") between 17 and 4112),
	CONSTRAINT "firm_secrets_key_id_format" CHECK ("firm_secrets"."key_id" ~ '^[0-9a-f]{12}$')
);
--> statement-breakpoint
ALTER TABLE "firm_secrets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "firm_secrets" ADD CONSTRAINT "firm_secrets_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "firm_secrets" AS PERMISSIVE FOR ALL TO public USING ("firm_secrets"."firm_id" = (select app_current_firm_id())) WITH CHECK ("firm_secrets"."firm_id" = (select app_current_firm_id()));--> statement-breakpoint
CREATE POLICY "secret_read" ON "firm_secrets" AS PERMISSIVE FOR SELECT TO current_user USING (true);--> statement-breakpoint
-- The one way to read a secret: run as the owner, callable by the jobs role only (the worker's
-- pg-boss connection, never the web app's), for one firm and one name. It returns the sealed value
-- as stored; only the worker, holding SECRETS_KEY, can open it. Under forced RLS the owner reads
-- through the secret_read policy above; each read still names its firm.
CREATE FUNCTION app_read_firm_secret(p_firm uuid, p_name text)
  RETURNS TABLE (ciphertext bytea, nonce bytea, key_id text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT s.ciphertext, s.nonce, s.key_id
      FROM public.firm_secrets AS s
     WHERE s.firm_id = p_firm AND s.name = p_name
  $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app_read_firm_secret(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_read_firm_secret(uuid, text) TO shiftdesk_jobs;
