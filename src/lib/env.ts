import { z } from "zod";

// Environment, split by who may read it (docs/decisions.md ADR-011):
// - app: web and worker. Data access only through the restricted app role.
// - worker: adds the pg-boss connection and the messaging transport.
// - admin: scripts only (migrate, seed, db:reset). The web and worker never parse owner credentials.
// Consumers get validated values instead of reading process.env directly.

export const APP_DB_ROLE = "shiftdesk_app";
export const JOBS_DB_ROLE = "shiftdesk_jobs";

type Source = Record<string, string | undefined>;

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });
const nodeEnv = z.enum(["development", "test", "production"]).default("development");

// The user pg will really connect as. As in pg-connection-string: a ?user= parameter overrides
// the URL's username, the last one wins when repeated, and an empty one falls back.
export function urlUser(url: string): string {
  const u = new URL(url);
  return u.searchParams.getAll("user").at(-1) || decodeURIComponent(u.username);
}

// A friendly early error. The real check (role attributes) runs on the first connection.
const connectsAs = (role: string) =>
  postgresUrl.refine((url) => urlUser(url) === role, {
    message: `must connect as the ${role} role (see .env.example)`,
  });

// The value in .env.example: fine locally, refused in production.
const EXAMPLE_SECRET = "dev-only-secret-change-me-in-prod-0123456789";

const appFields = {
  NODE_ENV: nodeEnv,
  DATABASE_URL: connectsAs(APP_DB_ROLE),
  // Keys the HMACs for rate-limit buckets and one-time codes. 32+ characters.
  SESSION_SECRET: z.string().min(32, { message: "must be at least 32 characters" }),
  // Firms get <slug>.<APP_BASE_DOMAIN>. Includes the port in dev (localhost:3000).
  APP_BASE_DOMAIN: z
    .string()
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/, {
      message: "must be a lowercase host name, optionally with a port (e.g. localhost:3000)",
    }),
  // The offline copy of My shifts (public/sw.js, ADR-016). Unset: on in production, off in
  // development (a slow first compile would show an old copy). The e2e run sets "on".
  OFFLINE_COPY: z.enum(["on", "off"]).optional(),
  // The public half of the deployment's VAPID key pair, for web push subscriptions. Unset: the profile says
  // phone notifications aren't switched on yet (PLAN.md Parking lot, "connect the real web push").
  // An empty value (as .env.example ships it) means not set.
  VAPID_PUBLIC_KEY: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z
      .string()
      .regex(/^[A-Za-z0-9_-]{80,100}$/, { message: "must be a base64url VAPID public key" })
      .optional(),
  ),
  // Alerts to the founder (src/lib/ops/, Phase 8): "console" (also when unset) writes each as one
  // error line in the log; "none" drops them (tests). The phone sender is added when it's connected
  // (PLAN.md Parking lot, "Connect alerts to your phone"). The web (bad webhook signatures) and the
  // worker both use it.
  ALERTS_TRANSPORT: z.enum(["console", "none"]).optional(),
  // Twilio signs every webhook with the account's auth token (X-Twilio-Signature): the webhooks
  // check it. Unset (as .env.example ships it): the webhooks answer 503 and store nothing (PLAN.md
  // Parking lot, "Connect Twilio"). A secret: never in the repo.
  TWILIO_AUTH_TOKEN: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().min(16, { message: "must be the Twilio account's auth token" }).optional(),
  ),
};

const realSecret = (e: { NODE_ENV: string; SESSION_SECRET: string }) =>
  e.NODE_ENV !== "production" || e.SESSION_SECRET !== EXAMPLE_SECRET;
const realSecretMessage = {
  path: ["SESSION_SECRET"],
  message: "the .env.example value must never be used in production",
};

// Alerts can't be switched off in production (they'd stop without anyone noticing).
const alertsOn = (e: { NODE_ENV: string; ALERTS_TRANSPORT?: string }) =>
  e.NODE_ENV !== "production" || e.ALERTS_TRANSPORT !== "none";
const alertsOnMessage = {
  path: ["ALERTS_TRANSPORT"],
  message: "alerts can't be turned off (none) when NODE_ENV=production",
};

export const appEnvSchema = z
  .object(appFields)
  .refine(realSecret, realSecretMessage)
  .refine(alertsOn, alertsOnMessage);

export const workerEnvSchema = z
  .object({
    ...appFields,
    DATABASE_JOBS_URL: connectsAs(JOBS_DB_ROLE),
    // "twilio" is added with the Twilio transport in Phase 4. Until then it is a config error.
    MESSAGING_TRANSPORT: z.enum(["console"]).default("console"),
    // Dev and e2e only: the console transport also appends messages here (see console.ts).
    CONSOLE_OUTBOX_FILE: z
      .string()
      .regex(/^\.dev\//)
      .optional(),
    // Google Sheets sync. Only "none" for now: the sync would book the names an office puts in
    // its sheet, and until the rules engine checks those bookings (credentials in date, golden
    // rule 6) it must not run for real. "google" (with GOOGLE_SERVICE_ACCOUNT_JSON_PATH, a key
    // file in the git-ignored secrets/) is added then, like "twilio" for messaging.
    SHEETS_TRANSPORT: z.enum(["none"]).default("none"),
    // Web push. "console" prints what would be pushed (development and tests); "none" pushes
    // nothing. The real sender ("webpush", with VAPID keys) is added when it's connected (PLAN.md
    // Parking lot); until then production must use "none".
    PUSH_TRANSPORT: z.enum(["console", "none"]).default("console"),
    // The web app's health check as the worker reaches it inside the server
    // (http://web:3000/api/health in deploy/docker-compose.yml). Unset: the ops alerts don't check it.
    HEALTH_CHECK_URL: z.url({ protocol: /^https?$/ }).optional(),
  })
  .refine(realSecret, realSecretMessage)
  .refine(alertsOn, alertsOnMessage)
  .refine((e) => e.NODE_ENV !== "production" || e.PUSH_TRANSPORT !== "console", {
    path: ["PUSH_TRANSPORT"],
    message: "console push is not allowed when NODE_ENV=production",
  })
  // Production must never silently print messages instead of sending them.
  .refine((e) => e.NODE_ENV !== "production" || e.MESSAGING_TRANSPORT !== "console", {
    path: ["MESSAGING_TRANSPORT"],
    message: "console transport is not allowed when NODE_ENV=production",
  });

export const adminEnvSchema = z
  .object({
    NODE_ENV: nodeEnv,
    DATABASE_ADMIN_URL: postgresUrl,
    DATABASE_URL: connectsAs(APP_DB_ROLE),
    DATABASE_JOBS_URL: connectsAs(JOBS_DB_ROLE),
  })
  .refine((e) => ![APP_DB_ROLE, JOBS_DB_ROLE].includes(urlUser(e.DATABASE_ADMIN_URL)), {
    path: ["DATABASE_ADMIN_URL"],
    message: "must be the owner, not the app or jobs role",
  });

export type AppEnv = z.infer<typeof appEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;
export type AdminEnv = z.infer<typeof adminEnvSchema>;

function parseWith<T>(schema: z.ZodType<T>, source: Source): T {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export const parseAppEnv = (source: Source): AppEnv => parseWith(appEnvSchema, source);
export const parseWorkerEnv = (source: Source): WorkerEnv => parseWith(workerEnvSchema, source);
export const parseAdminEnv = (source: Source): AdminEnv => parseWith(adminEnvSchema, source);

let app: AppEnv | undefined;
let worker: WorkerEnv | undefined;
let admin: AdminEnv | undefined;

export const offlineCopyOn = (e: { NODE_ENV: string; OFFLINE_COPY?: "on" | "off" }) =>
  e.OFFLINE_COPY ? e.OFFLINE_COPY === "on" : e.NODE_ENV === "production";

export function appEnv(): AppEnv {
  app ??= parseAppEnv(process.env);
  return app;
}
export function workerEnv(): WorkerEnv {
  worker ??= parseWorkerEnv(process.env);
  return worker;
}
export function adminEnv(): AdminEnv {
  admin ??= parseAdminEnv(process.env);
  return admin;
}
