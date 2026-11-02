CREATE TABLE "office_user_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"office_user_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "office_user_clients_firm_id_id_key" UNIQUE("firm_id","id"),
	CONSTRAINT "office_user_clients_firm_id_user_client_key" UNIQUE("firm_id","office_user_id","client_id")
);
--> statement-breakpoint
ALTER TABLE "office_user_clients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clients_firm_id_id_key" UNIQUE("firm_id","id"),
	CONSTRAINT "clients_name_length" CHECK (char_length("clients"."name") between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "clients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "office_users" ADD COLUMN "dashboard_cards" text[];--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "office_user_clients" ADD CONSTRAINT "office_user_clients_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_user_clients" ADD CONSTRAINT "office_user_clients_office_user_fk" FOREIGN KEY ("firm_id","office_user_id") REFERENCES "public"."office_users"("firm_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_user_clients" ADD CONSTRAINT "office_user_clients_client_fk" FOREIGN KEY ("firm_id","client_id") REFERENCES "public"."clients"("firm_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clients_firm_id_lower_name_key" ON "clients" USING btree ("firm_id",lower("name"));--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_client_fk" FOREIGN KEY ("firm_id","client_id") REFERENCES "public"."clients"("firm_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_users" ADD CONSTRAINT "office_users_dashboard_cards_check" CHECK ("office_users"."dashboard_cards" is null or cardinality("office_users"."dashboard_cards") <= 20);--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "office_user_clients" AS PERMISSIVE FOR ALL TO public USING ("office_user_clients"."firm_id" = (select app_current_firm_id())) WITH CHECK ("office_user_clients"."firm_id" = (select app_current_firm_id()));--> statement-breakpoint
CREATE POLICY "firm_isolation" ON "clients" AS PERMISSIVE FOR ALL TO public USING ("clients"."firm_id" = (select app_current_firm_id())) WITH CHECK ("clients"."firm_id" = (select app_current_firm_id()));