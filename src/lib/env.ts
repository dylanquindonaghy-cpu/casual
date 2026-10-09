import { z } from "zod";
import { databaseTlsOn } from "./db/tls";

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

// An empty value (as the env examples ship them) means not set.
const unsetIfEmpty = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema);

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

// In production every database address must ask for checked TLS (databaseTlsOn, src/lib/db/tls.ts;
// audit L38).
const DATABASE_TLS_MESSAGE =
  'in production the database connection must be encrypted and checked: the address needs sslmode=verify-full&sslrootcert=/app/db-ca.pem (after a "?", or "&" if it already has one; docs/runbooks.md "Deploy")';
const tlsInProduction =
  (...keys: string[]) =>
  (e: Record<string, unknown>, ctx: z.RefinementCtx) => {
    if (e.NODE_ENV !== "production") return;
    for (const key of keys) {
      const url = e[key];
      if (typeof url === "string" && !databaseTlsOn(url)) {
        ctx.addIssue({ code: "custom", path: [key], message: DATABASE_TLS_MESSAGE });
      }
    }
  };

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
  // Failing on purpose, for the browser tests of the error screens (src/lib/e2e/fails-once.ts: a
  // page that fails once, and the page's frame failing once). Only the e2e run sets it
  // (playwright.config.ts); a deployment never does (tests/unit/error-pages.test.ts checks the
  // deploy and CI files), and it's refused unless APP_BASE_DOMAIN is localhost. Unset: the test
  // page is "not found" and nothing fails.
  E2E_TEST_PAGES: z.enum(["on"]).optional(),
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
  // Postcode look-ups and travel times (docs/office-v2.md 5.4), a server setting, never per firm.
  // "fake" (the default): made-up points for the ZZ postcodes only (src/lib/travel/geocoder.ts),
  // for development, tests and a demo; a real postcode is never found. "traveltime": postcodes.io
  // for postcodes (only the postcode is sent) and, from 12G.2, TravelTime for travel times; refused
  // under NODE_ENV=test, so no test can reach either. Real use waits for "Connect postcodes.io and
  // TravelTime" (PLAN.md Parking lot). An empty value means not set.
  TRAVEL_PROVIDER: unsetIfEmpty(z.enum(["fake", "traveltime"]).default("fake")),
};

// Tests never reach postcodes.io or TravelTime.
const noRealTravelInTests = (e: { NODE_ENV: string; TRAVEL_PROVIDER: string }) =>
  e.NODE_ENV !== "test" || e.TRAVEL_PROVIDER !== "traveltime";
const noRealTravelInTestsMessage = {
  path: ["TRAVEL_PROVIDER"],
  message: "tests never call postcodes.io or TravelTime: traveltime is refused when NODE_ENV=test",
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
  .superRefine(tlsInProduction("DATABASE_URL"))
  .refine(realSecret, realSecretMessage)
  .refine(alertsOn, alertsOnMessage)
  .refine(noRealTravelInTests, noRealTravelInTestsMessage)
  // The test-only pages never on a real address, even if the switch were copied into one.
  .refine((e) => !e.E2E_TEST_PAGES || /^localhost(:\d+)?$/.test(e.APP_BASE_DOMAIN), {
    path: ["E2E_TEST_PAGES"],
    message: "the test-only pages are only for a local test run (APP_BASE_DOMAIN=localhost)",
  });

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
    // Google Sheets sync (src/lib/roster/sheets/transport.ts). "none" (the default): no sheet is
    // ever read, and the sync's tick isn't scheduled. "google": the real client, as the service
    // account whose key file is at GOOGLE_SERVICE_ACCOUNT_JSON_PATH (in the git-ignored secrets/,
    // never the repo or the database). Off until a Google account exists (PLAN.md Parking lot,
    // "Connect the real Google Sheets"); the owner then connects a firm's sheet (npm run
    // firm:sheet).
    SHEETS_TRANSPORT: z.enum(["none", "google"]).default("none"),
    // An empty value (as the env examples ship it) means not set.
    GOOGLE_SERVICE_ACCOUNT_JSON_PATH: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.string().max(500).optional(),
    ),
    // Web push. "console" prints what would be pushed (development and tests); "none" pushes
    // nothing. The real sender ("webpush", with VAPID keys) is added when it's connected (PLAN.md
    // Parking lot); until then production must use "none".
    PUSH_TRANSPORT: z.enum(["console", "none"]).default("console"),
    // The web app's health check as the worker reaches it inside the server
    // (http://web:3000/api/health in deploy/docker-compose.yml). Unset: the ops alerts don't check it.
    HEALTH_CHECK_URL: z.url({ protocol: /^https?$/ }).optional(),
    // Where the worker writes its sign of life for its container's health check (src/worker/
    // heartbeat.ts; /tmp/shiftdesk-worker-alive in deploy/docker-compose.yml). Unset: none.
    WORKER_HEARTBEAT_FILE: z
      .string()
      .regex(/^\/tmp\/[\w.-]+$/)
      .optional(),
    // Email, worker only (the web app sends none; docs/office-v2.md 5.8). "console" prints it
    // (development and tests; refused in production). "smtp" sends through any provider's SMTP
    // server (src/lib/messaging/smtp.ts): refused under NODE_ENV=test, so no test can reach one.
    // Real sending waits for "Connect an email provider (SMTP)" (PLAN.md Parking lot). An empty
    // value (as the env examples ship them) means not set.
    EMAIL_TRANSPORT: unsetIfEmpty(z.enum(["console", "smtp"]).default("console")),
    SMTP_HOST: unsetIfEmpty(
      z
        .string()
        .max(253)
        .regex(
          /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$/,
          {
            message: "must be the SMTP server's host name",
          },
        )
        .optional(),
    ),
    // 465: TLS from the first byte; any other port (587, or 2525 where offered) must upgrade with
    // STARTTLS. Never plain text either way.
    SMTP_PORT: unsetIfEmpty(z.coerce.number().int().min(1).max(65535).default(587)),
    SMTP_USER: unsetIfEmpty(z.string().max(320).optional()),
    // A secret: never logged, never in the repo, never given to the web app.
    SMTP_PASS: unsetIfEmpty(z.string().max(1000).optional()),
    // The address every email comes from (a domain the provider has verified).
    SMTP_FROM: unsetIfEmpty(
      z.email({ message: "must be the email address mail comes from" }).optional(),
    ),
    // AI, worker only (docs/office-v2.md 5.8): Claude through the Anthropic API
    // (src/lib/ai/anthropic.ts). "none" (the default): no AI, and the code's fallback answers.
    // "anthropic": refused under NODE_ENV=test, so no test can call it. Real calls wait for
    // "Connect the Anthropic API" (PLAN.md Parking lot).
    AI_TRANSPORT: unsetIfEmpty(z.enum(["none", "anthropic"]).default("none")),
    // A secret: never logged, never in the repo, never given to the web app.
    ANTHROPIC_API_KEY: unsetIfEmpty(z.string().max(500).optional()),
    // TravelTime (docs/office-v2.md 5.4; 12G.2), for TRAVEL_PROVIDER=traveltime: worker only (the
    // travel job). Secrets: never logged, never in the repo, never given to the web app.
    TRAVELTIME_APP_ID: unsetIfEmpty(z.string().max(200).optional()),
    TRAVELTIME_API_KEY: unsetIfEmpty(z.string().max(500).optional()),
    // Haiku (CLAUDE.md "Stack").
    AI_MODEL: unsetIfEmpty(
      z
        .string()
        .max(100)
        .regex(/^claude-[a-z0-9]+(-[a-z0-9.]+)*$/, { message: "must be a Claude model id" })
        .default("claude-haiku-4-5"),
    ),
  })
  .superRefine(tlsInProduction("DATABASE_URL", "DATABASE_JOBS_URL"))
  .refine(realSecret, realSecretMessage)
  .refine(alertsOn, alertsOnMessage)
  .refine(noRealTravelInTests, noRealTravelInTestsMessage)
  .refine((e) => e.SHEETS_TRANSPORT !== "google" || e.GOOGLE_SERVICE_ACCOUNT_JSON_PATH, {
    path: ["GOOGLE_SERVICE_ACCOUNT_JSON_PATH"],
    message: "SHEETS_TRANSPORT=google needs the path to the service account's key file",
  })
  .refine((e) => e.NODE_ENV !== "production" || e.PUSH_TRANSPORT !== "console", {
    path: ["PUSH_TRANSPORT"],
    message: "console push is not allowed when NODE_ENV=production",
  })
  // Production must never silently print messages instead of sending them.
  .refine((e) => e.NODE_ENV !== "production" || e.MESSAGING_TRANSPORT !== "console", {
    path: ["MESSAGING_TRANSPORT"],
    message: "console transport is not allowed when NODE_ENV=production",
  })
  .refine((e) => e.NODE_ENV !== "production" || e.EMAIL_TRANSPORT !== "console", {
    path: ["EMAIL_TRANSPORT"],
    message: "console email is not allowed when NODE_ENV=production",
  })
  .refine((e) => e.NODE_ENV !== "test" || e.EMAIL_TRANSPORT !== "smtp", {
    path: ["EMAIL_TRANSPORT"],
    message: "tests never send real email: smtp is refused when NODE_ENV=test",
  })
  .refine((e) => e.EMAIL_TRANSPORT !== "smtp" || (e.SMTP_HOST && e.SMTP_FROM), {
    path: ["SMTP_HOST"],
    message: "EMAIL_TRANSPORT=smtp needs SMTP_HOST and SMTP_FROM",
  })
  .refine((e) => !e.SMTP_USER === !e.SMTP_PASS, {
    path: ["SMTP_PASS"],
    message: "SMTP_USER and SMTP_PASS go together",
  })
  .refine((e) => e.NODE_ENV !== "test" || e.AI_TRANSPORT !== "anthropic", {
    path: ["AI_TRANSPORT"],
    message: "tests never call the Anthropic API: anthropic is refused when NODE_ENV=test",
  })
  .refine((e) => e.AI_TRANSPORT !== "anthropic" || e.ANTHROPIC_API_KEY, {
    path: ["ANTHROPIC_API_KEY"],
    message: "AI_TRANSPORT=anthropic needs ANTHROPIC_API_KEY",
  })
  .refine(
    (e) => e.TRAVEL_PROVIDER !== "traveltime" || (e.TRAVELTIME_APP_ID && e.TRAVELTIME_API_KEY),
    {
      path: ["TRAVELTIME_API_KEY"],
      message: "TRAVEL_PROVIDER=traveltime needs TRAVELTIME_APP_ID and TRAVELTIME_API_KEY (worker)",
    },
  );

export const adminEnvSchema = z
  .object({
    NODE_ENV: nodeEnv,
    DATABASE_ADMIN_URL: postgresUrl,
    DATABASE_URL: connectsAs(APP_DB_ROLE),
    DATABASE_JOBS_URL: connectsAs(JOBS_DB_ROLE),
  })
  .superRefine(tlsInProduction("DATABASE_ADMIN_URL", "DATABASE_URL", "DATABASE_JOBS_URL"))
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
