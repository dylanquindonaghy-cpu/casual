import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAdminEnv, parseAppEnv, parseDemoResetEnv, parseWorkerEnv } from "@/lib/env";

// The demo server (16.2; docs/runbooks.md "A demo server"; ADR-025): its compose file read by
// Docker Compose itself, as the server reads it (both files, chosen by COMPOSE_FILE in its .env,
// the example's addresses filled in from the example's passwords), the app's own settings
// accepting what each service gets, and its reset script run for real with a stand-in `docker`.
// Nothing here starts a container or reaches a server: `docker compose config` only reads files.

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

// deploy/env.demo.example with its empty values filled in, all made up.
const FILLED: Record<string, string> = {
  SHIFTDESK_IMAGE: "ghcr.io/example/shiftdesk",
  APP_BASE_DOMAIN: "demo.example.co.uk",
  ACME_EMAIL: "ops@example.com",
  DEMO_SITE_PASSWORD: "made-up demo password",
  SESSION_SECRET: "made-up-session-secret-for-this-test-only-0123",
  DEMO_DB_PASSWORD: "aaaa1111",
  DEMO_DB_APP_PASSWORD: "bbbb2222",
  DEMO_DB_JOBS_PASSWORD: "cccc3333",
};
const filledExample = (fill = FILLED) =>
  read("deploy/env.demo.example").replace(/^([A-Z_]+)=.*$/gm, (line, name: string) =>
    fill[name] === undefined ? line : `${name}=${fill[name]}`,
  );

interface Service {
  image?: string;
  command?: string[] | null;
  environment?: Record<string, string>;
  ports?: unknown[];
  restart?: string;
  profiles?: string[];
  depends_on?: Record<string, { condition: string }>;
  healthcheck?: { test: string[] };
  volumes?: { type: string; source: string; target: string; read_only?: boolean }[];
}

// `docker compose` in a folder laid out as /opt/shiftdesk is: both compose files and a .env, no -f.
function compose(args: string[], env = filledExample()): string {
  const dir = mkdtempSync(join(tmpdir(), "demo-compose-"));
  copyFileSync(join(ROOT, "deploy/docker-compose.yml"), join(dir, "docker-compose.yml"));
  copyFileSync(join(ROOT, "deploy/docker-compose.demo.yml"), join(dir, "docker-compose.demo.yml"));
  writeFileSync(join(dir, ".env"), env);
  return execFileSync("docker", ["compose", ...args], {
    cwd: dir,
    encoding: "utf8",
    // A clean environment: compose reads the caller's variables before .env.
    env: {
      NODE_ENV: "test",
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      ...(process.env.DOCKER_HOST ? { DOCKER_HOST: process.env.DOCKER_HOST } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}
// deploy.sh's line that picks the app's image, run as deploy.sh runs it, in such a folder.
function deployImageLine(env: string): string {
  const line = read("deploy/deploy.sh")
    .split("\n")
    .find((l) => l.startsWith('image="$('));
  if (!line) throw new Error("deploy.sh has no image line");
  const dir = mkdtempSync(join(tmpdir(), "demo-image-"));
  copyFileSync(join(ROOT, "deploy/docker-compose.yml"), join(dir, "docker-compose.yml"));
  copyFileSync(join(ROOT, "deploy/docker-compose.demo.yml"), join(dir, "docker-compose.demo.yml"));
  writeFileSync(join(dir, ".env"), env);
  return execFileSync(
    "bash",
    ["-c", `set -euo pipefail; compose=(docker compose); ${line}; echo "$image"`],
    {
      cwd: dir,
      encoding: "utf8",
      env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
    },
  ).trim();
}

const config = (env?: string): Record<string, Service> =>
  (
    JSON.parse(
      compose(
        [
          "--profile",
          "migrate",
          "--profile",
          "owner",
          "--profile",
          "demo-reset",
          "config",
          "--format",
          "json",
        ],
        env,
      ),
    ) as { services: Record<string, Service> }
  ).services;
const services = config();
const SOCKET = { type: "volume", source: "pgsocket", target: "/var/run/postgresql" };
const mounts = (name: string) =>
  services[name]?.volumes?.map((v) => ({
    type: v.type,
    source: v.source,
    target: v.target,
    ...(v.read_only ? { read_only: true } : {}),
  }));

describe("the demo server's services (deploy/docker-compose.demo.yml with docker-compose.yml)", () => {
  it("are the real server's, plus Postgres and the one-off demo reset; up starts Postgres, the app, the worker and Caddy", () => {
    expect(Object.keys(services).sort()).toEqual([
      "caddy",
      "demo-reset",
      "migrate",
      "owner",
      "postgres",
      "web",
      "worker",
    ]);
    expect(compose(["config", "--services"]).trim().split("\n").sort()).toEqual([
      "caddy",
      "postgres",
      "web",
      "worker",
    ]);
    // deploy.sh's own line for the app's image, run here: the app's, never Postgres' or Caddy's.
    expect(deployImageLine(filledExample())).toBe("ghcr.io/example/shiftdesk:main");
    expect(deployImageLine(filledExample().replace(/^COMPOSE_FILE=.*$/m, ""))).toBe(
      "ghcr.io/example/shiftdesk:main",
    );
  });

  it("Postgres: reached over its socket only (no network address, no port), with a password there too", () => {
    const pg = services.postgres;
    expect(pg?.image).toBe("postgres:16");
    expect(pg?.command).toEqual(["postgres", "-c", "listen_addresses="]);
    expect(pg?.ports ?? []).toEqual([]);
    expect(pg?.environment?.POSTGRES_INITDB_ARGS).toBe("--auth-local=scram-sha-256");
    expect(pg?.environment?.POSTGRES_PASSWORD).toBe("aaaa1111");
    expect(pg?.restart).toBe("unless-stopped");
    expect(mounts("postgres")).toEqual([
      { type: "volume", source: "pgdata", target: "/var/lib/postgresql/data" },
      SOCKET,
    ]);
    expect(pg?.healthcheck?.test).toEqual([
      "CMD",
      "pg_isready",
      "-q",
      "-h",
      "/var/run/postgresql",
      "-U",
      "postgres",
    ]);
  });

  it("only Caddy is reachable from outside, as on the real server", () => {
    for (const [name, s] of Object.entries(services)) {
      if (name !== "caddy") expect(s.ports ?? [], name).toEqual([]);
    }
  });

  it("the app's services reach the database by its socket, after it's healthy; no CA file, no secrets folder", () => {
    for (const name of ["web", "worker", "migrate", "owner", "demo-reset"]) {
      expect(services[name]?.depends_on?.postgres?.condition, name).toBe("service_healthy");
      expect(mounts(name)?.[0], name).toEqual(SOCKET);
      for (const v of services[name]?.volumes ?? []) {
        expect(v.target, name).not.toBe("/app/db-ca.pem");
        expect(v.target, name).not.toBe("/app/secrets");
      }
    }
    expect(services.web?.environment?.DATABASE_URL).toBe(
      "postgres://shiftdesk_app:bbbb2222@localhost/shiftdesk?host=/var/run/postgresql",
    );
    expect(services.migrate?.environment?.DATABASE_ADMIN_URL).toBe(
      "postgres://postgres:aaaa1111@localhost/shiftdesk?host=/var/run/postgresql&options=-c%20role%3Dshiftdesk_owner",
    );
  });

  it("demo mode for the web app and the worker, from this file; the outbox: the worker writes it, the web app only reads it", () => {
    expect(services.web?.environment).toMatchObject({
      DEMO_MODE: "on",
      CONSOLE_OUTBOX_FILE: ".dev/outbox.jsonl",
      DEMO_SITE_PASSWORD: "made-up demo password",
      TRAVEL_PROVIDER: "fake",
      AI_TRANSPORT: "none",
      MESSAGING_TRANSPORT: "console",
    });
    // The web app's words follow the worker's sender (P2.7): on the Demo phone, by message.
    expect(services.web?.environment?.MESSAGING_TRANSPORT).toBe(
      services.worker?.environment?.MESSAGING_TRANSPORT,
    );
    expect(services.worker?.environment).toMatchObject({
      DEMO_MODE: "on",
      CONSOLE_OUTBOX_FILE: ".dev/outbox.jsonl",
      MESSAGING_TRANSPORT: "console",
      EMAIL_TRANSPORT: "console",
      WEBHOOK_TRANSPORT: "console",
      PUSH_TRANSPORT: "none",
      SHEETS_TRANSPORT: "none",
      AI_TRANSPORT: "none",
      TRAVEL_PROVIDER: "fake",
    });
    expect(services.worker?.environment).not.toHaveProperty("DEMO_SITE_PASSWORD");
    expect(mounts("web")).toEqual([
      SOCKET,
      { type: "volume", source: "outbox", target: "/app/.dev", read_only: true },
    ]);
    expect(mounts("worker")).toEqual([
      SOCKET,
      { type: "volume", source: "outbox", target: "/app/.dev" },
    ]);
    // The worker always runs on a demo server (it sends the login links).
    expect(services.worker?.profiles ?? []).toEqual([]);
  });

  it("each secret goes only where it's needed: the superuser's password, the site password; no shifts line", () => {
    const holders = (value: string) =>
      Object.entries(services)
        .filter(([, svc]) => JSON.stringify(svc.environment ?? {}).includes(value))
        .map(([name]) => name)
        .sort();
    // The superuser's password: Postgres itself and the three one-offs that log in as it.
    expect(holders(FILLED.DEMO_DB_PASSWORD ?? "")).toEqual([
      "demo-reset",
      "migrate",
      "owner",
      "postgres",
    ]);
    for (const name of ["web", "worker", "caddy"]) {
      expect(Object.keys(services[name]?.environment ?? {}), name).not.toContain(
        "DATABASE_ADMIN_URL",
      );
    }
    expect(holders(FILLED.DEMO_SITE_PASSWORD ?? "")).toEqual(["web"]);
    // Caddy never reaches the database.
    expect(services.caddy?.volumes?.map((v) => v.source)).not.toContain("pgsocket");
    // Twilio's webhooks refuse everything on a demo server, whatever .env says.
    const withToken =
      filledExample().replace(/^TWILIO_AUTH_TOKEN=.*$/m, "") +
      "\nTWILIO_AUTH_TOKEN=made-up-token\n";
    const svc = config(withToken);
    expect(svc.web?.environment?.TWILIO_AUTH_TOKEN).toBe("");
    expect(svc.worker?.environment?.TWILIO_AUTH_TOKEN).toBe("");
  });

  it("the demo reset: one-off, the owner's login, demo mode, the outbox it empties", () => {
    const reset = services["demo-reset"];
    expect(reset?.profiles).toEqual(["demo-reset"]);
    expect(reset?.restart).toBeUndefined();
    expect(reset?.image).toBe("ghcr.io/example/shiftdesk:main");
    expect(reset?.command).toEqual(["node", "--import", "tsx", "scripts/demo-reset.ts"]);
    expect(Object.keys(reset?.environment ?? {}).sort()).toEqual(
      [
        "APP_BASE_DOMAIN",
        "CONSOLE_OUTBOX_FILE",
        "DATABASE_ADMIN_URL",
        "DATABASE_JOBS_URL",
        "DATABASE_URL",
        "DEMO_MODE",
        "NODE_ENV",
      ].sort(),
    );
    expect(mounts("demo-reset")).toEqual([
      SOCKET,
      { type: "volume", source: "outbox", target: "/app/.dev" },
    ]);
  });

  it("the app's own settings accept what each service gets, in production", () => {
    const env = (name: string) => services[name]?.environment ?? {};
    const web = parseAppEnv(env("web"));
    expect([web.NODE_ENV, web.DEMO_MODE, web.DEMO_SITE_PASSWORD]).toEqual([
      "production",
      "on",
      "made-up demo password",
    ]);
    // The worker reads the app's settings too (its database, its links): both must take its env.
    expect(parseAppEnv(env("worker")).DEMO_MODE).toBe("on");
    const worker = parseWorkerEnv(env("worker"));
    expect([worker.NODE_ENV, worker.DEMO_MODE, worker.WEBHOOK_TRANSPORT]).toEqual([
      "production",
      "on",
      "console",
    ]);
    expect(parseAdminEnv(env("migrate")).NODE_ENV).toBe("production");
    expect(parseDemoResetEnv(env("demo-reset")).DEMO_MODE).toBe("on");
  });

  it("refuses to start without the demo's password or its database password", () => {
    for (const name of ["DEMO_SITE_PASSWORD", "DEMO_DB_PASSWORD"]) {
      expect(() => config(filledExample({ ...FILLED, [name]: "" })), name).toThrow();
    }
  });

  it("without the demo file (a real server's .env has no COMPOSE_FILE): no Postgres, no demo", () => {
    const real = filledExample().replace(/^COMPOSE_FILE=.*$/m, "");
    const out = compose(["config", "--format", "json"], real);
    expect(out).not.toMatch(/DEMO_MODE|postgres:16|pgsocket/);
  });
});

describe("deploy/env.demo.example", () => {
  const example = read("deploy/env.demo.example");

  it("names every value either compose file needs, and holds no real secret", () => {
    const used = new Set(
      ["deploy/docker-compose.yml", "deploy/docker-compose.demo.yml"].flatMap((f) =>
        [...read(f).matchAll(/\$\{([A-Z_]+):\?/g)].map((m) => m[1]),
      ),
    );
    const listed = new Set([...example.matchAll(/^([A-Z_]+)=/gm)].map((m) => m[1]));
    expect([...used].filter((name) => !listed.has(name))).toEqual([]);
    for (const secret of [
      "DEMO_SITE_PASSWORD",
      "SESSION_SECRET",
      "DEMO_DB_PASSWORD",
      "DEMO_DB_APP_PASSWORD",
      "DEMO_DB_JOBS_PASSWORD",
    ]) {
      expect(example, secret).toMatch(new RegExp(`^${secret}=$`, "m"));
    }
  });

  it("chooses both compose files", () => {
    expect(example).toMatch(/^COMPOSE_FILE=docker-compose\.yml:docker-compose\.demo\.yml$/m);
  });
});

describe("the image, for the demo server", () => {
  it("has an empty .dev folder the app's user owns, so the outbox volume is theirs to write", () => {
    const dockerfile = read("Dockerfile");
    const runtime = dockerfile.slice(dockerfile.indexOf("AS runtime"));
    expect(runtime).toContain("mkdir -p /app/.dev && chown node:node /app/.dev");
    expect(runtime.indexOf("/app/.dev")).toBeLessThan(runtime.indexOf("USER node"));
    // The deploy files go into the image (the runbook copies them out of it onto the server).
    expect(read(".dockerignore").split("\n")).not.toContain("deploy/");
  });
});

describe("deploy.sh on a demo server", () => {
  it("lets COMPOSE_FILE choose the files (no -f), and skips Caddy's and Postgres' images", () => {
    const script = read("deploy/deploy.sh");
    expect(script).toContain("compose=(docker compose)");
    expect(script).not.toMatch(/docker compose -f/);
    expect(script).toMatch(/^image="\$\("\$\{compose\[@\]\}" config --images \|/m);
  });
});

describe("deploy/demo-reset.sh, run", () => {
  // A stand-in `docker` that writes down each command and answers as Docker would.
  const FAKE_DOCKER = `#!/usr/bin/env bash
echo "$*" >> "$FAKE_LOG"
case "$*" in
  "compose --profile demo-reset config --services")
    [ -z "$FAKE_CONFIG_FAILS" ] || { echo "required variable DEMO_DB_PASSWORD is missing" >&2; exit 1; }
    if [ -n "$FAKE_DEMO" ]; then printf 'postgres\\nweb\\nworker\\ncaddy\\ndemo-reset\\n'; else printf 'web\\ncaddy\\n'; fi ;;
  "compose stop web worker") ;;
  "compose run --rm demo-reset") [ -z "$FAKE_RESET_FAILS" ] || { echo "refused" >&2; exit 1; } ;;
  "compose up -d --remove-orphans --wait --wait-timeout 180") ;;
  *) echo "unexpected docker command: $*" >&2; exit 99 ;;
esac
`;
  function reset(opts: { demo?: boolean; fails?: boolean; configFails?: boolean } = {}) {
    const dir = mkdtempSync(join(tmpdir(), "demo-reset-sh-"));
    writeFileSync(join(dir, "docker"), FAKE_DOCKER);
    chmodSync(join(dir, "docker"), 0o755);
    const log = join(dir, "docker.log");
    writeFileSync(log, "");
    const run = spawnSync("bash", [join(ROOT, "deploy/demo-reset.sh")], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH ?? ""}`,
        SHIFTDESK_LOCK: join(dir, "lock"),
        FAKE_LOG: log,
        FAKE_DEMO: opts.demo === false ? "" : "yes",
        FAKE_RESET_FAILS: opts.fails ? "yes" : "",
        FAKE_CONFIG_FAILS: opts.configFails ? "yes" : "",
      },
    });
    const calls = readFileSync(log, "utf8").split("\n").filter(Boolean);
    return { status: run.status, out: run.stdout, err: run.stderr, calls };
  }

  it("stops the app, loads the demo afresh, starts everything again", () => {
    const r = reset();
    expect(r.status).toBe(0);
    expect(r.calls).toEqual([
      "compose --profile demo-reset config --services",
      "compose stop web worker",
      "compose run --rm demo-reset",
      "compose up -d --remove-orphans --wait --wait-timeout 180",
    ]);
    expect(r.out).toContain("The demo is loaded afresh.");
  });

  it("a reset that fails (or is refused): everything is started again, and the run fails", () => {
    const r = reset({ fails: true });
    expect(r.status).toBe(1);
    expect(r.calls.at(-1)).toBe("compose up -d --remove-orphans --wait --wait-timeout 180");
    expect(r.err).toContain("The demo reset didn't finish");
  });

  it("not a demo server: refuses before stopping anything", () => {
    const r = reset({ demo: false });
    expect(r.status).toBe(1);
    expect(r.calls).toEqual(["compose --profile demo-reset config --services"]);
    expect(r.err).toContain("Not a demo server");
  });

  it("settings Compose can't read: says so, and stops before stopping anything", () => {
    const r = reset({ configFails: true });
    expect(r.status).toBe(1);
    expect(r.calls).toEqual(["compose --profile demo-reset config --services"]);
    expect(r.err).toContain("Docker Compose couldn't read the settings");
    expect(r.err).not.toContain("Not a demo server");
  });

  it("is valid bash, stops at the first error, and never runs during a deploy (the same lock)", () => {
    execFileSync("bash", ["-n", "deploy/demo-reset.sh"], { cwd: ROOT });
    const script = read("deploy/demo-reset.sh");
    expect(script).toContain("set -euo pipefail");
    expect(script).toContain('exec 9>"${SHIFTDESK_LOCK:-/run/lock/shiftdesk-deploy.lock}"');
    expect(read("deploy/deploy.sh")).toContain(
      'exec 9>"${SHIFTDESK_LOCK:-/run/lock/shiftdesk-deploy.lock}"',
    );
  });

  it("runs every night at 04:00 UK time (after the 02:30 UTC restart), a missed night when next on", () => {
    const timer = read("deploy/shiftdesk-demo-reset.timer");
    expect(timer).toContain("OnCalendar=*-*-* 04:00:00 Europe/London");
    expect(timer).toContain("Persistent=true");
    const service = read("deploy/shiftdesk-demo-reset.service");
    expect(service).toContain("ExecStart=/opt/shiftdesk/demo-reset.sh");
    expect(service).toContain("Requires=docker.service");
    expect(service).toContain("Type=oneshot");
  });
});
