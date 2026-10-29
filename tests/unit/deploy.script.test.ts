import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// deploy/deploy.sh run for real, with a stand-in `docker` first on its PATH that writes down every
// command it's given and answers as Docker would for the case being tried. Before (audit M8) only
// the script's text was checked, and it did nothing at all when the image was unchanged: a change
// to .env, or a service newly turned on (the worker, once with COMPOSE_PROFILES=worker; since P2.5
// on the first deploy of a compose file where it has no profile), never reached the server.

const ROOT = process.cwd();
const IMAGE = "ghcr.io/owner/repo:main";

// The stand-in. FAKE_RUNNING: the running app containers' ids; FAKE_RUNNING_IMAGE: the image they
// run; FAKE_TARGET: the chosen image's id; FAKE_UP_OUTPUT / FAKE_UP_FAILS: what `up` says and
// whether it fails; FAKE_REVISION: the image's commit label.
const FAKE_DOCKER = `#!/usr/bin/env bash
echo "$*" >> "$FAKE_LOG"
case "$*" in
  "compose config --images") printf 'caddy:2.10\\npostgres:16\\n%s\\n' "${IMAGE}" ;;
  "compose pull --quiet web") ;;
  "image inspect --format {{.Id}} ${IMAGE}") echo "$FAKE_TARGET" ;;
  "compose ps --status running --quiet web worker")
    if [ -n "$FAKE_RUNNING" ]; then printf '%s\\n' $FAKE_RUNNING; fi ;;
  "inspect --format {{.Image}} "*) echo "$FAKE_RUNNING_IMAGE" ;;
  "compose run --rm migrate") ;;
  "compose up -d --remove-orphans --wait --wait-timeout 180")
    printf '%s\\n' "$FAKE_UP_OUTPUT" >&2
    [ -z "$FAKE_UP_FAILS" ] || exit 1 ;;
  "image prune -f") ;;
  "image inspect --format {{index .Config.Labels \\"org.opencontainers.image.revision\\"}} ${IMAGE}") echo "$FAKE_REVISION" ;;
  *) echo "unexpected docker command: $*" >&2; exit 99 ;;
esac
`;

interface Case {
  running?: string;
  runningImage?: string;
  target?: string;
  upOutput?: string;
  upFails?: boolean;
  now?: string;
  args?: string[];
}

function deploy(c: Case) {
  const dir = mkdtempSync(join(tmpdir(), "deploy-sh-"));
  writeFileSync(join(dir, "docker"), FAKE_DOCKER);
  chmodSync(join(dir, "docker"), 0o755);
  const log = join(dir, "docker.log");
  writeFileSync(log, "");
  const run = spawnSync("bash", [join(ROOT, "deploy/deploy.sh"), ...(c.args ?? [])], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH ?? ""}`,
      SHIFTDESK_NOW: c.now ?? "1200",
      SHIFTDESK_LOCK: join(dir, "lock"),
      FAKE_LOG: log,
      FAKE_RUNNING: c.running ?? "",
      FAKE_RUNNING_IMAGE: c.runningImage ?? "sha256:old",
      FAKE_TARGET: c.target ?? "sha256:new",
      FAKE_UP_OUTPUT: c.upOutput ?? " Container shiftdesk-web-1  Running",
      FAKE_UP_FAILS: c.upFails ? "yes" : "",
      FAKE_REVISION: "0123456789abcdef0123456789abcdef01234567",
    },
  });
  const calls = readFileSync(log, "utf8").split("\n").filter(Boolean);
  return { status: run.status, out: run.stdout, err: run.stderr, calls };
}

const MIGRATE = "compose run --rm migrate";
const UP = "compose up -d --remove-orphans --wait --wait-timeout 180";

describe("deploy.sh, run", () => {
  it("a new image: the migration step, then the new version, and the commit it came from", () => {
    const r = deploy({ running: "web1", runningImage: "sha256:old", target: "sha256:new" });
    expect(r.status).toBe(0);
    expect(r.calls.indexOf(MIGRATE)).toBeGreaterThan(-1);
    expect(r.calls.indexOf(UP)).toBeGreaterThan(r.calls.indexOf(MIGRATE));
    expect(r.out).toContain(`Deploying ${IMAGE} (sha256:new).`);
    expect(r.out).toContain(`Deployed ${IMAGE} (commit 0123456789abcdef0123456789abcdef01234567).`);
  });

  it("nothing running (first start, or a failed deploy): deploys", () => {
    const r = deploy({ running: "" });
    expect(r.calls).toContain(MIGRATE);
    expect(r.calls).toContain(UP);
  });

  it("rolling back with --no-migrate: the new version without the migration step", () => {
    const r = deploy({ running: "web1", args: ["--now", "--no-migrate"] });
    expect(r.calls).not.toContain(MIGRATE);
    expect(r.calls).toContain(UP);
  });

  // Audit M8: these did nothing before.
  it("the same image, a setting changed in .env: applied (the changed containers recreated), no migration", () => {
    const r = deploy({
      running: "web1",
      runningImage: "sha256:same",
      target: "sha256:same",
      upOutput: " Container shiftdesk-web-1  Recreated\n Container shiftdesk-web-1  Healthy",
    });
    expect(r.status).toBe(0);
    expect(r.calls).toContain(UP);
    expect(r.calls).not.toContain(MIGRATE);
    expect(r.out).toContain(`Applied the settings in .env (${IMAGE}, unchanged).`);
    expect(r.out).not.toContain("Deploying");
  });

  it("the same image, the worker newly turned on (the first compose file without its profile, P2.5): started", () => {
    const r = deploy({
      running: "web1",
      runningImage: "sha256:same",
      target: "sha256:same",
      upOutput: " Container shiftdesk-worker-1  Created\n Container shiftdesk-worker-1  Started",
    });
    expect(r.calls).toContain(UP);
    expect(r.out).toContain("Applied the settings in .env");
  });

  it("the same image, nothing changed: says nothing (it runs every 2 minutes)", () => {
    const r = deploy({
      running: "web1 worker1",
      runningImage: "sha256:same",
      target: "sha256:same",
      upOutput: " Container shiftdesk-web-1  Running\n Container shiftdesk-web-1  Healthy",
    });
    expect(r.status).toBe(0);
    expect(r.calls).not.toContain(MIGRATE);
    expect(r.out).toBe("");
  });

  it("the same image, but applying the settings fails: the run fails, saying why", () => {
    const r = deploy({
      running: "web1",
      runningImage: "sha256:same",
      target: "sha256:same",
      upOutput: " Container shiftdesk-worker-1  Error: unhealthy",
      upFails: true,
    });
    expect(r.status).toBe(1);
    expect(r.err).toContain("Container shiftdesk-worker-1  Error: unhealthy");
    expect(r.err).toContain("No new image, but the app isn't running healthily");
  });

  it("a new version that doesn't come up healthy: the run fails, saying why", () => {
    const r = deploy({
      running: "web1",
      upOutput: " Container shiftdesk-web-1  Error: unhealthy",
      upFails: true,
    });
    expect(r.status).toBe(1);
    expect(r.err).toContain("The new version didn't come up healthy");
    expect(r.out).not.toContain("Deployed");
  });

  it("between 05:30 and 09:00 UK time: touches nothing at all (a settings change waits too)", () => {
    const r = deploy({ now: "0700", running: "web1", runningImage: "sha256:same" });
    expect(r.status).toBe(0);
    expect(r.calls).toEqual([]);
    expect(r.out).toContain("No deploys between 05:30 and 09:00 UK time");
  });
});

describe("the image deploy.sh reports", () => {
  it("carries the commit it was built from (GitHub Actions labels it)", () => {
    const workflow = readFileSync(join(ROOT, ".github/workflows/deploy.yml"), "utf8");
    expect(workflow).toContain(
      'docker build --label "org.opencontainers.image.revision=$SHA" -t "$image:$SHA" .',
    );
  });
});
