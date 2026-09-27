import { z } from "zod";

// Only the variables Phase 0 uses. Later phases add theirs here, so every
// consumer gets a validated value instead of reading process.env directly.
export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    DATABASE_URL_TEST: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
    // "twilio" is added with the Twilio transport in Phase 4. Until then it is a config error.
    MESSAGING_TRANSPORT: z.enum(["console"]).default("console"),
  })
  // Production must never silently print messages instead of sending them.
  .refine((e) => e.NODE_ENV !== "production" || e.MESSAGING_TRANSPORT !== "console", {
    path: ["MESSAGING_TRANSPORT"],
    message: "console transport is not allowed when NODE_ENV=production",
  });

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

let cached: Env | undefined;
export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
