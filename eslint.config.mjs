import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

// Golden rule 2: app code reaches the database only through withFirm() (src/lib/db/scoped.ts)
// and resolveFirmBySlug() (src/lib/db/directory.ts). Outside src/lib/db it can't import the raw
// pool, the owner connection or code, any Postgres driver, or the owner's credentials. pg-boss
// is allowed only where jobs are defined and worked (src/lib/jobs, src/worker). Scripts and tests
// are not restricted.
const DB = "App code must use withFirm() from @/lib/db/scoped (golden rule 2).";
const DRIVER = "(pg|pg-pool|pg-connection-string|pg-native)(/.*)?";
const DRIZZLE_DRIVER =
  "drizzle-orm/(node-postgres|postgres-js|pg-proxy|pglite|neon-http|neon-serverless|vercel-postgres|bun-sql)(/.*)?";

function dbBoundary({ allowPgBoss, pagesAndActions = false }) {
  const modules = [DRIVER, DRIZZLE_DRIVER, ...(allowPgBoss ? [] : ["pg-boss(/.*)?"])];
  const moduleRegex = `^(${modules.join("|")})$`;
  return {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          { regex: "(^|/)db/(pool|admin)(/.*|\\.ts)?$", message: DB },
          { regex: moduleRegex, message: `${DB} Jobs: sendFirmJob() from @/lib/jobs/firm-job.` },
          {
            regex: "(^|/)env(\\.ts)?$",
            importNames: ["adminEnv", "parseAdminEnv", "adminEnvSchema"],
            message: "Owner credentials are for scripts only (ADR-011).",
          },
          // Pages and actions take the firm from the request's host, never from input (ADR-012).
          ...(pagesAndActions
            ? [
                {
                  regex: "(^|/)db/scoped(\\.ts)?$",
                  importNames: ["withFirm", "createWithFirm"],
                  message:
                    "Pages and actions use withCurrentFirm() from @/lib/tenancy/current-firm (ADR-012).",
                },
              ]
            : []),
        ],
      },
    ],
    "no-restricted-syntax": [
      "error",
      {
        selector: `ImportExpression[source.value=/(^|\\/)db\\/(pool|admin)|${moduleRegex.replaceAll("/", "\\/")}/]`,
        message: DB,
      },
      { selector: "CallExpression[callee.name='require']", message: "Use import, not require()." },
    ],
  };
}

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    rules: {
      // CLAUDE.md: no `any`.
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/db/**", "src/lib/jobs/**", "src/worker/**", "src/app/**"],
    rules: dbBoundary({ allowPgBoss: false }),
  },
  {
    files: ["src/app/**/*.{ts,tsx}"],
    rules: dbBoundary({ allowPgBoss: false, pagesAndActions: true }),
  },
  {
    files: ["src/lib/jobs/**/*.{ts,tsx}", "src/worker/**/*.{ts,tsx}"],
    rules: dbBoundary({ allowPgBoss: true }),
  },
  {
    // Next renders an action's redirect() target by fetching it from the server's own origin,
    // which drops the firm's Host header (the page renders as the base domain). Actions return a
    // result and the browser navigates itself. (Flat config replaces a rule's options per file,
    // so this block repeats the boundary's syntax rules.)
    files: ["src/app/**/*actions.ts"],
    rules: {
      "no-restricted-syntax": [
        ...dbBoundary({ allowPgBoss: false, pagesAndActions: true })["no-restricted-syntax"],
        {
          selector:
            "ImportDeclaration[source.value='next/navigation'] ImportSpecifier[imported.name=/^(redirect|permanentRedirect)$/]",
          message: "Server actions don't redirect(): return a result and navigate in the browser.",
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "node_modules/**",
    "drizzle/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
    // The UI skills: third-party files, copied as published (.claude/skills/README.md).
    ".claude/skills/**",
  ]),
]);
