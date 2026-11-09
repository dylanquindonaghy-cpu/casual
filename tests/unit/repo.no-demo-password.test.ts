import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hashStaffPassword, passwordMatches, STAFF_LOGIN_HASH } from "@/lib/demo/staff-login";

// The staffing demo login's password (Phase 31.1) is never in the repo: not in a file, a test, a
// doc or a commit message. Only its salted scrypt hash is. This test can't hold the password to
// look for it, so it checks every word that starts like the login name ("Staffing…", any case)
// against the committed hash instead: a word that matches it is the password.

const START = /staffing[^\s"'`<>()[\]{},;|*]{0,24}/gi;

// Every word starting with "staffing", with up to three characters taken off its end (a full stop
// or a bracket after it in a sentence).
function candidates(text: string): Set<string> {
  const found = new Set<string>();
  for (const [word] of text.matchAll(START)) {
    for (let cut = 0; cut <= 3 && word.length - cut > "staffing".length; cut += 1) {
      found.add(word.slice(0, word.length - cut));
    }
  }
  return found;
}

async function leaks(texts: Iterable<[string, string]>, hash: string): Promise<string[]> {
  const where = new Map<string, string[]>();
  for (const [name, text] of texts) {
    for (const word of candidates(text)) where.set(word, [...(where.get(word) ?? []), name]);
  }
  const found: string[] = [];
  for (const [word, names] of where) {
    if (await passwordMatches(word, hash)) found.push(...names);
  }
  return found;
}

const git = (...args: string[]) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

function repoTexts(): [string, string][] {
  const files = git("ls-files", "--cached", "--others", "--exclude-standard", "-z")
    .split("\0")
    .filter((path) => path !== "" && !path.startsWith("node_modules"));
  const texts: [string, string][] = [];
  for (const path of files) {
    let text: string;
    try {
      if (statSync(path).size > 5_000_000) continue;
      text = readFileSync(path, "utf8");
    } catch {
      continue; // listed but gone (a deleted file not yet committed)
    }
    if (!text.includes("\u0000")) texts.push([path, text]);
  }
  // The commit messages too.
  texts.push(["git log", git("log", "-n", "500", "--format=%B")]);
  return texts;
}

describe("the staffing demo login's password is nowhere in the repo", () => {
  it("no file and no commit message holds it", async () => {
    const texts = repoTexts();
    expect(texts.length).toBeGreaterThan(500);
    expect(await leaks(texts, STAFF_LOGIN_HASH)).toEqual([]);
  }, 120_000);

  it("the check finds a password like it, wherever it's written", async () => {
    const planted = `Staffing${randomBytes(3).toString("hex")}!`;
    const hash = await hashStaffPassword(planted, randomBytes(16));
    const found = await leaks(
      [
        ["a.ts", `const password = "${planted}";`],
        ["b.md", `Log in with the password ${planted}.`],
        ["c.md", `(${planted.toUpperCase()})`],
        ["d.md", "Staffing and resourcing view, Staffing (demo)."],
      ],
      hash,
    );
    expect(found).toEqual(["a.ts", "b.md"]);
  });
});
