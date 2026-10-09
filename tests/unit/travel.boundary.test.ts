import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Pages never call the travel service (docs/office-v2.md 5.4; 12G.2): nothing the web app loads
// (every file under src/app, server actions included) reaches the provider, its worker-side
// factory or the travel job by a static import. The worker loads them; the wave job reaches them
// only through a dynamic import, in the worker (src/lib/offers/waves.ts).

const SRC = join(process.cwd(), "src");
const FORBIDDEN = [
  "src/lib/travel/provider.ts",
  "src/lib/travel/worker-provider.ts",
  "src/lib/travel/estimates.ts",
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function valueImports(text: string): string[] {
  const specs: string[] = [];
  const statement = /^\s*(?:import|export)\s+(?!type\s)(?:[\s\S]*?\sfrom\s+)?["']([^"']+)["']/gm;
  for (const m of text.matchAll(statement)) if (m[1]) specs.push(m[1]);
  return specs;
}

function resolveLocal(from: string, spec: string): string | null {
  const base = spec.startsWith("@/")
    ? join(SRC, spec.slice(2))
    : spec.startsWith(".")
      ? resolve(dirname(from), spec)
      : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (existsSync(candidate) && candidate.match(/\.(ts|tsx)$/)) return candidate;
  }
  return null;
}

function reaches(entry: string): string[] | null {
  const seen = new Set<string>();
  const walk = (file: string, chain: string[]): string[] | null => {
    if (seen.has(file)) return null;
    seen.add(file);
    const rel = relative(process.cwd(), file).replace(/\\/g, "/");
    if (FORBIDDEN.includes(rel)) return [...chain, rel];
    for (const spec of valueImports(readFileSync(file, "utf8"))) {
      const next = resolveLocal(file, spec);
      if (next) {
        const found = walk(next, [...chain, rel]);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(entry, []);
}

describe("the web app never loads the travel service", () => {
  const pages = sourceFiles(join(SRC, "app"));

  it("finds the web app's files", () => {
    expect(pages.length).toBeGreaterThan(50);
  });

  it.each(pages.map((p) => relative(process.cwd(), p)))("%s", (page) => {
    expect(reaches(join(process.cwd(), page))).toBeNull();
  });

  it("the check would catch one that did", () => {
    expect(reaches(join(SRC, "worker/jobs/index.ts"))).not.toBeNull();
  });
});
