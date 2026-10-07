import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The deploy (Phase 8): the image (Dockerfile), the server's services (deploy/docker-compose.yml),
// the pull-based deploy (deploy/deploy.sh and its systemd timer) and the workflow that builds the
// image (.github/workflows/deploy.yml). Nothing here builds or pulls an image or reaches a server:
// `docker compose config` only reads the file. What it pins: who gets which secret, that only Caddy
// is reachable from outside, restarts after the nightly reboot, a non-root image with no secrets,
// no deploys on event mornings, and a workflow that only runs after CI passes on main.

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

// Every value the compose file asks for, made up.
const ENV = [
  "SHIFTDESK_IMAGE=ghcr.io/example/shiftdesk",
  "SHIFTDESK_TAG=0123abc",
  "APP_BASE_DOMAIN=shiftdesk.example",
  "DATABASE_URL=postgres://shiftdesk_app:app@db.example:5432/shiftdesk",
  "DATABASE_JOBS_URL=postgres://shiftdesk_jobs:jobs@db.example:5432/shiftdesk",
  "DATABASE_ADMIN_URL=postgres://shiftdesk_owner:owner@db.example:5432/shiftdesk",
  "SESSION_SECRET=made-up-session-secret-for-this-test-only",
  "MESSAGING_TRANSPORT=console",
  "ACME_EMAIL=ops@example.com",
].join("\n");

interface ComposeService {
  image: string;
  command?: string[] | null;
  environment?: Record<string, string>;
  ports?: { published: string; target: number; protocol?: string }[];
  restart?: string;
  profiles?: string[];
  stop_grace_period?: string;
  healthcheck?: { test: string[] };
  volumes?: { source: string; target: string; read_only?: boolean; type: string }[];
}

function composeRun(args: string[], env: string): string {
  const dir = mkdtempSync(join(tmpdir(), "compose-"));
  writeFileSync(join(dir, "test.env"), env);
  const out = execFileSync(
    "docker",
    ["compose", "-f", "deploy/docker-compose.yml", "--env-file", join(dir, "test.env"), ...args],
    // A clean environment: compose reads the caller's variables before the env file, and this
    // process has the dev .env's (SESSION_SECRET and the rest) loaded.
    {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        NODE_ENV: "test",
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        ...(process.env.DOCKER_HOST ? { DOCKER_HOST: process.env.DOCKER_HOST } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return out;
}

// Every service, the profiled ones (migrate, worker) included.
const composeConfig = (env = ENV): { services: Record<string, ComposeService> } =>
  JSON.parse(
    composeRun(["--profile", "migrate", "--profile", "worker", "config", "--format", "json"], env),
  ) as { services: Record<string, ComposeService> };

describe("deploy/docker-compose.yml", () => {
  const { services } = composeConfig();

  it("web, worker, caddy and the one-off migrate step; the app's three from one image at the chosen tag", () => {
    expect(Object.keys(services).sort()).toEqual(["caddy", "migrate", "web", "worker"]);
    for (const name of ["web", "worker", "migrate"]) {
      expect(services[name]?.image, name).toBe("ghcr.io/example/shiftdesk:0123abc");
    }
    expect(services.worker?.command).toEqual(["node", "--import", "tsx", "src/worker/index.ts"]);
    expect(services.migrate?.command).toEqual(["node", "--import", "tsx", "scripts/migrate.ts"]);
  });

  it("the values come from the server's .env (the file given), not from anywhere else", () => {
    expect(services.web?.environment?.DATABASE_URL).toBe(
      "postgres://shiftdesk_app:app@db.example:5432/shiftdesk",
    );
    expect(services.migrate?.environment?.DATABASE_ADMIN_URL).toBe(
      "postgres://shiftdesk_owner:owner@db.example:5432/shiftdesk",
    );
  });

  it("each service gets only the secrets it needs: the owner's login only to migrate", () => {
    const keys = (name: string) => Object.keys(services[name]?.environment ?? {}).sort();
    expect(keys("web")).toEqual(
      [
        "ALERTS_TRANSPORT", // where the founder's alerts go (not a secret): bad webhook signatures
        "APP_BASE_DOMAIN",
        "DATABASE_URL",
        "NODE_ENV",
        "OFFLINE_COPY", // the phones' offline copy on or off (not a secret; Phase 10 task 17)
        "SESSION_SECRET",
        "TWILIO_AUTH_TOKEN",
        "VAPID_PUBLIC_KEY",
      ].sort(),
    );
    expect(keys("worker")).toContain("DATABASE_JOBS_URL");
    // Email over SMTP (12X.2): the worker alone sends it, so only it gets the provider's login.
    expect(keys("worker")).toEqual(
      expect.arrayContaining([
        "EMAIL_TRANSPORT",
        "SMTP_HOST",
        "SMTP_PORT",
        "SMTP_USER",
        "SMTP_PASS",
        "SMTP_FROM",
      ]),
    );
    for (const name of ["web", "caddy", "migrate"]) {
      expect(keys(name), name).not.toContain("SMTP_PASS");
    }
    // AI (12X.3): the worker alone asks Claude, so only it gets the Anthropic key.
    expect(keys("worker")).toEqual(
      expect.arrayContaining(["AI_TRANSPORT", "ANTHROPIC_API_KEY", "AI_MODEL"]),
    );
    expect(services.worker?.environment?.AI_TRANSPORT).toBe("none");
    for (const name of ["web", "caddy", "migrate"]) {
      expect(keys(name), name).not.toContain("ANTHROPIC_API_KEY");
    }
    for (const name of ["web", "worker", "caddy"]) {
      expect(keys(name), name).not.toContain("DATABASE_ADMIN_URL");
    }
    expect(keys("web")).not.toContain("DATABASE_JOBS_URL");
    // The Google service account's key: only the worker, read-only, from secrets/ beside the
    // compose file (never the image). Besides that, web and the worker see only the database's CA
    // certificate, read-only (tests/unit/deploy.database-tls.test.ts; ADR-021).
    expect(keys("worker")).toContain("GOOGLE_SERVICE_ACCOUNT_JSON_PATH");
    expect(services.worker?.volumes?.map((v) => [v.target, v.read_only, v.type])).toEqual([
      ["/app/db-ca.pem", true, "bind"],
      ["/app/secrets", true, "bind"],
    ]);
    expect(services.worker?.volumes?.[1]?.source).toMatch(/\/secrets$/);
    expect(services.web?.volumes?.map((v) => [v.target, v.read_only, v.type])).toEqual([
      ["/app/db-ca.pem", true, "bind"],
    ]);
    expect(keys("caddy")).toEqual(["ACME_EMAIL", "APP_BASE_DOMAIN"]);
    expect(keys("migrate")).toEqual(
      ["DATABASE_ADMIN_URL", "DATABASE_JOBS_URL", "DATABASE_URL", "NODE_ENV"].sort(),
    );
    for (const name of ["web", "worker", "migrate"]) {
      expect(services[name]?.environment?.NODE_ENV, name).toBe("production");
    }
  });

  it("only Caddy is reachable from outside, on 80 and 443; the web app isn't published", () => {
    for (const [name, service] of Object.entries(services)) {
      if (name === "caddy") continue;
      expect(service.ports ?? [], name).toEqual([]);
    }
    expect(services.caddy?.ports?.map((p) => [p.published, p.target]).sort()).toEqual([
      ["443", 443],
      ["80", 80],
    ]);
  });

  it("everything long-running restarts by itself (the nightly reboot); migrate is never started by up", () => {
    for (const name of ["web", "worker", "caddy"]) {
      expect(services[name]?.restart, name).toBe("unless-stopped");
    }
    expect(services.migrate?.profiles).toEqual(["migrate"]);
    expect(services.migrate?.restart).toBeUndefined();
  });

  it("the worker only with COMPOSE_PROFILES=worker (it can't start in production before Twilio), with time to finish its jobs", () => {
    expect(services.worker?.profiles).toEqual(["worker"]);
    expect(services.worker?.stop_grace_period).toBe("45s");
    const running = (env: string) =>
      composeRun(["config", "--services"], env).trim().split("\n").sort();
    // As env.example ships it (no messaging yet, the worker off): valid, and only web and Caddy.
    const today = ENV.replace("MESSAGING_TRANSPORT=console", "MESSAGING_TRANSPORT=");
    expect(running(`${today}\nCOMPOSE_PROFILES=`)).toEqual(["caddy", "web"]);
    expect(running(`${ENV}\nCOMPOSE_PROFILES=worker`)).toEqual(["caddy", "web", "worker"]);
  });

  // The adversarial review (Phase 10 task 17): with no health check, a worker that kept crashing
  // looked started to `up --wait`, so deploy.sh reported success every 2 minutes.
  it("the worker is healthy only while it writes its sign of life (a crashing or hung one never is)", () => {
    const worker = services.worker;
    expect(worker?.environment?.WORKER_HEARTBEAT_FILE).toBe("/tmp/shiftdesk-worker-alive");
    const test = worker?.healthcheck?.test ?? [];
    expect(test.slice(0, 3)).toEqual(["CMD", "node", "-e"]);
    const check = (file: string) => {
      try {
        execFileSync("node", ["-e", test[3] ?? ""], {
          env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", WORKER_HEARTBEAT_FILE: file },
          stdio: "ignore",
        });
        return "healthy";
      } catch {
        return "unhealthy";
      }
    };
    const dir = mkdtempSync(join(tmpdir(), "heartbeat-"));
    const fresh = join(dir, "fresh");
    writeFileSync(fresh, "1");
    const stale = join(dir, "stale");
    writeFileSync(stale, "1");
    const twoMinutesAgo = new Date(Date.now() - 120_000);
    utimesSync(stale, twoMinutesAgo, twoMinutesAgo);
    expect([check(fresh), check(stale), check(join(dir, "missing"))]).toEqual([
      "healthy",
      "unhealthy",
      "unhealthy",
    ]);
  });

  it("the web app's health check asks /api/health; Caddy's file is read-only and its certificates kept", () => {
    expect(services.web?.healthcheck?.test.join(" ")).toContain("http://localhost:3000/api/health");
    const caddyfile = services.caddy?.volumes?.find((v) => v.target === "/etc/caddy/Caddyfile");
    expect(caddyfile?.read_only).toBe(true);
    expect(services.caddy?.volumes?.find((v) => v.target === "/data")?.type).toBe("volume");
  });

  it("the one-off owner service: only with its profile, the owner's login plus what app code needs, nothing published", () => {
    const withOwner = JSON.parse(
      composeRun(["--profile", "owner", "config", "--format", "json"], ENV),
    ) as { services: Record<string, ComposeService> };
    const owner = withOwner.services.owner;
    expect(owner?.profiles).toEqual(["owner"]);
    expect(owner?.image).toBe("ghcr.io/example/shiftdesk:0123abc");
    expect(owner?.restart).toBeUndefined();
    expect(owner?.ports ?? []).toEqual([]);
    expect(Object.keys(owner?.environment ?? {}).sort()).toEqual(
      [
        "APP_BASE_DOMAIN",
        "DATABASE_ADMIN_URL",
        "DATABASE_JOBS_URL",
        "DATABASE_URL",
        "NODE_ENV",
        "SESSION_SECRET",
      ].sort(),
    );
    // Not among what `up` starts, whatever the worker's profile.
    const running = composeRun(["config", "--services"], `${ENV}\nCOMPOSE_PROFILES=worker`)
      .trim()
      .split("\n");
    expect(running).not.toContain("owner");
  });

  it("refuses to start without the values it needs (no silent empty secrets)", () => {
    const without = ENV.split("\n")
      .filter((line) => !line.startsWith("SESSION_SECRET="))
      .join("\n");
    expect(() => composeConfig(without)).toThrow();
  });
});

describe("deploy/env.example (the server's .env, to fill in)", () => {
  it("names every value the compose file uses, and holds no real secret", () => {
    const compose = read("deploy/docker-compose.yml");
    const used = new Set([...compose.matchAll(/\$\{([A-Z_]+)/g)].map((m) => m[1]));
    const example = read("deploy/env.example");
    const listed = new Set([...example.matchAll(/^([A-Z_]+)=/gm)].map((m) => m[1]));
    expect([...used].filter((name) => !listed.has(name))).toEqual([]);
    expect(example).toMatch(/^SESSION_SECRET=$/m);
    expect(example).toMatch(/^MESSAGING_TRANSPORT=$/m);
    expect(example).toMatch(/^COMPOSE_PROFILES=$/m);
  });
});

describe("the image (Dockerfile)", () => {
  const dockerfile = read("Dockerfile");
  const runtime = dockerfile.slice(dockerfile.indexOf("AS runtime"));

  it("builds with npm ci and next build, runs as the unprivileged node user in production", () => {
    expect(dockerfile).toContain("RUN npm ci");
    expect(dockerfile).toContain("RUN npm run build");
    expect(runtime).toMatch(/^USER node$/m);
    expect(runtime).toMatch(/NODE_ENV=production/);
    expect(runtime).toContain('CMD ["node_modules/.bin/next", "start", "-p", "3000"]');
  });

  it("the app's code is root's (the app can't change it); only Next's cache is the app user's", () => {
    expect(runtime).toContain("COPY --from=build /app /app");
    expect(runtime).not.toMatch(/--chown=node/);
    expect(runtime).toContain("chown -R node:node /app/.next/cache");
  });

  it("no secrets in the image: the build-only placeholders stay in the build stage", () => {
    expect(runtime).not.toMatch(/DATABASE_URL|SESSION_SECRET|APP_BASE_DOMAIN/);
    expect(dockerfile).not.toMatch(/COPY[^\n]*\.env/);
    const ignored = read(".dockerignore").split("\n");
    // At any depth: a filled-in deploy/.env must never reach an image.
    for (const entry of [
      "**/.env",
      "**/.env.*",
      "**/secrets/",
      "**/*.pem",
      ".git/",
      ".claude/",
      ".dev/",
      "node_modules/",
    ]) {
      expect(ignored, entry).toContain(entry);
    }
  });
});

describe("the pull-based deploy (deploy/deploy.sh and its timer)", () => {
  const lock = join(mkdtempSync(join(tmpdir(), "deploy-")), "lock");
  const dryRun = (now: string, ...flags: string[]) =>
    execFileSync("bash", ["deploy/deploy.sh", "--dry-run", ...flags], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, SHIFTDESK_NOW: now, SHIFTDESK_LOCK: lock },
      stdio: ["ignore", "pipe", "pipe"],
    });
  const script = read("deploy/deploy.sh");

  it("is valid bash and stops at the first error", () => {
    execFileSync("bash", ["-n", "deploy/deploy.sh"], { cwd: ROOT });
    expect(script).toContain("set -euo pipefail");
  });

  it("never deploys between 05:30 and 09:00 UK time on its own; any other time it may", () => {
    for (const now of ["0530", "0600", "0745", "0859"]) {
      expect(dryRun(now), now).toContain("No deploys between 05:30 and 09:00 UK time");
    }
    for (const now of ["0000", "0529", "0900", "1330", "2359"]) {
      expect(dryRun(now), now).toContain("Would deploy now");
    }
    expect(script).toContain("TZ=Europe/London date +%H%M");
  });

  it("by hand with --now it may (a fix on an event morning); an unknown option stops it", () => {
    expect(dryRun("0600", "--now")).toContain("Would deploy now");
    expect(() => dryRun("1200", "--nwo")).toThrow();
  });

  it("deploys whenever the running containers aren't on the chosen image (so a failed deploy is retried)", () => {
    expect(script).toContain(
      'running_ids="$("${compose[@]}" ps --status running --quiet web worker)"',
    );
    expect(script).toContain(
      `[[ "$(docker inspect --format '{{.Image}}' "$id")" == "$target" ]] || up_to_date=false`,
    );
    // Only the app image is pulled each time (Caddy's registry being down mustn't block deploys).
    expect(script).toContain('"${compose[@]}" pull --quiet web');
  });

  it("migrates first (skippable for a rollback), waits until healthy, one run at a time", () => {
    expect(script).toContain('flock -n 9 || { echo "Another deploy is running."; exit 0; }');
    expect(script).toMatch(
      /if \[\[ "\$migrate" == true \]\]; then\n\s+"\$\{compose\[@\]\}" run --rm migrate\nfi/,
    );
    expect(script.indexOf('"${compose[@]}" run --rm migrate')).toBeLessThan(
      script.indexOf('"${compose[@]}" up -d --remove-orphans --wait --wait-timeout 180'),
    );
  });

  it("the timer runs it every 2 minutes, from /opt/shiftdesk, after Docker, never hanging for ever", () => {
    expect(read("deploy/shiftdesk-deploy.timer")).toMatch(/OnUnitActiveSec=2min/);
    const service = read("deploy/shiftdesk-deploy.service");
    expect(service).toContain("ExecStart=/opt/shiftdesk/deploy.sh");
    expect(service).toContain("Requires=docker.service");
    expect(service).toContain("Type=oneshot");
    expect(service).toContain("TimeoutStartSec=20min");
  });
});

describe("the workflows", () => {
  const deploy = read(".github/workflows/deploy.yml");

  it("builds and pushes the image only after CI passes on a push to this repository's own main", () => {
    expect(deploy).toMatch(
      /workflow_run:\n\s+workflows: \[CI\]\n\s+types: \[completed\]\n\s+branches: \[main\]/,
    );
    for (const condition of [
      "github.event.workflow_run.conclusion == 'success'",
      "github.event.workflow_run.event == 'push'", // never a pull request: a fork's branch can be "main"
      "github.event.workflow_run.head_branch == 'main'",
      "github.event.workflow_run.head_repository.full_name == github.repository",
    ]) {
      expect(deploy, condition).toContain(condition);
    }
    expect(deploy).not.toMatch(/workflow_dispatch|^\s+push:/m);
  });

  it("moves main only to the tip of main (an older run finishing late can't roll the server back)", () => {
    expect(deploy).toContain('tip="$(gh api "repos/$GITHUB_REPOSITORY/commits/main" --jq .sha)"');
    expect(deploy.indexOf('if [ "$tip" = "$SHA" ]; then')).toBeLessThan(
      deploy.indexOf('docker push "$image:main"'),
    );
    expect(deploy).toContain('docker push "$image:$SHA"');
    expect(deploy).toContain("persist-credentials: false");
  });

  it("only the built-in token, allowed to write packages; nothing reaches the server", () => {
    expect(deploy).toMatch(/permissions:\n\s+contents: read\n\s+packages: write/);
    expect(new Set([...deploy.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]))).toEqual(
      new Set(["GITHUB_TOKEN"]),
    );
    expect(deploy).not.toMatch(/ssh|scp/i);
  });

  it("CI builds the image on every push (so a broken Dockerfile shows)", () => {
    expect(read(".github/workflows/ci.yml")).toMatch(
      /docker:\n[\s\S]*?run: docker build -t shiftdesk:ci \./,
    );
  });
});
