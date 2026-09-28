import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Client components (files starting "use client") go into the browser bundle with everything they
// import. If that reaches database code, the build fails (pg needs Node's net, tls, fs...), or
// worse, server code ships to the browser. This follows every value import from each client
// component (types are erased, so `import type` is skipped) and fails if the chain reaches
// src/lib/db/, the pg drivers or Node's built-in modules. Server-action files ("use server") are
// where the chain stops: Next replaces them with a reference in the browser.
// (The type checker and the tests can't see this: only `next build` does.)

const SRC = join(process.cwd(), "src");
const FORBIDDEN_PACKAGES = ["pg", "pg-boss", "drizzle-orm/node-postgres", "exceljs"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

const directive = (text: string, name: string) =>
  new RegExp(`^\\s*(?:\\/\\/[^\\n]*\\n\\s*)*["']${name}["']`).test(text);

// Value imports and re-exports: `import x from`, `import { a } from`, `import "x"`, `export ... from`.
// `import type` / `export type` carry no code and are skipped.
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

// The first forbidden thing a client component reaches, as a chain of files, or null.
function forbiddenChain(entry: string): string[] | null {
  const seen = new Set<string>();
  const walk = (file: string, chain: string[]): string[] | null => {
    if (seen.has(file)) return null;
    seen.add(file);
    const rel = relative(process.cwd(), file).replace(/\\/g, "/");
    if (rel.startsWith("src/lib/db/")) return [...chain, rel];
    const text = readFileSync(file, "utf8");
    if (chain.length > 0 && directive(text, "use server")) return null;
    for (const spec of valueImports(text)) {
      if (
        spec.startsWith("node:") ||
        FORBIDDEN_PACKAGES.some((p) => spec === p || spec.startsWith(`${p}/`))
      ) {
        return [...chain, rel, spec];
      }
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

const clientComponents = sourceFiles(SRC).filter((f) =>
  directive(readFileSync(f, "utf8"), "use client"),
);

describe("client components never pull server code into the browser", () => {
  it("finds the client components", () => {
    expect(clientComponents.length).toBeGreaterThanOrEqual(5);
  });

  it.each(clientComponents.map((f) => relative(process.cwd(), f).replace(/\\/g, "/")))(
    "%s reaches no database code, pg driver or Node built-in",
    (file) => {
      expect(forbiddenChain(join(process.cwd(), file))).toBeNull();
    },
  );

  it("would catch a client component importing a module that reaches the database", () => {
    // The mistake this test exists for: a client file importing values from a server module.
    expect(forbiddenChain(join(SRC, "lib/portal/cancel-shift.ts"))).toEqual(
      expect.arrayContaining(["src/lib/portal/cancel-shift.ts"]),
    );
    expect(forbiddenChain(join(SRC, "lib/portal/cancel-reasons.ts"))).toBeNull();
  });
});
