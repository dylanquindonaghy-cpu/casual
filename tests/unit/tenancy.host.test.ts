import { describe, expect, it } from "vitest";
import { normaliseHost, parseHost } from "@/lib/tenancy/host";
import { isValidSlug } from "@/lib/tenancy/slug";

// Host -> firm, the pure part: which hosts are the home page, which are a firm's portal, and
// which we don't serve at all.

describe("parseHost with a dev base domain (localhost:3000)", () => {
  const base = "localhost:3000";
  it.each([
    ["localhost:3000", { kind: "apex" }],
    ["acme.localhost:3000", { kind: "firm", slug: "acme" }],
    ["northline.localhost:3000", { kind: "firm", slug: "northline" }],
    ["ACME.LOCALHOST:3000", { kind: "firm", slug: "acme" }],
    ["acme.localhost.:3000", { kind: "firm", slug: "acme" }],
    ["  acme.localhost:3000 ", { kind: "firm", slug: "acme" }],
    ["a1-b2.localhost:3000", { kind: "firm", slug: "a1-b2" }],
  ])("%s -> %j", (host, expected) => {
    expect(parseHost(host, base)).toEqual(expected);
  });

  it.each([
    ["no Host header", null],
    ["empty", ""],
    ["another site", "evil.example:3000"],
    ["an IP address", "127.0.0.1:3000"],
    ["an IPv6 address", "[::1]:3000"],
    ["a nested subdomain", "x.acme.localhost:3000"],
    ["the wrong port", "acme.localhost:4000"],
    ["no port", "acme.localhost"],
    ["a lookalike base", "acme.xlocalhost:3000"],
    ["an empty label", ".localhost:3000"],
    ["a one-letter slug", "a.localhost:3000"],
    ["a leading hyphen", "-acme.localhost:3000"],
    ["a trailing hyphen", "acme-.localhost:3000"],
    ["an underscore", "ac_me.localhost:3000"],
    ["a slug over 20 characters", "abcdefghijklmnopqrstu.localhost:3000"],
    ["reserved: www", "www.localhost:3000"],
    ["reserved: portal", "portal.localhost:3000"],
    ["reserved: api", "api.localhost:3000"],
    ["reserved: app", "app.localhost:3000"],
    ["reserved: admin", "admin.localhost:3000"],
    ["punycode", "xn--80ak6aa92e.localhost:3000"],
    ["a dot after the port", "acme.localhost:3000."],
    ["a Kelvin sign that lowercases to k", "\u212Acme.localhost:3000"],
    ["a non-ASCII letter", "\u00e5cme.localhost:3000"],
  ])("rejects %s", (_label, host) => {
    expect(parseHost(host, base)).toBeNull();
  });
});

describe("parseHost with a production base domain (no port)", () => {
  const base = "shiftdesk.co.uk";
  it.each([
    ["shiftdesk.co.uk", { kind: "apex" }],
    ["acme.shiftdesk.co.uk", { kind: "firm", slug: "acme" }],
    ["acme.shiftdesk.co.uk.", { kind: "firm", slug: "acme" }],
  ])("%s -> %j", (host, expected) => {
    expect(parseHost(host, base)).toEqual(expected);
  });

  it.each([
    "acme.shiftdesk.co.uk:443",
    "shifts.acmeevents.co.uk", // a custom domain: Phase 8
    "acme.shiftdesk.co.uk.evil.example",
    "shiftdesk.co.uk.evil.example",
  ])("rejects %s", (host) => {
    expect(parseHost(host, base)).toBeNull();
  });
});

describe("helpers", () => {
  it("normaliseHost lowercases, trims and drops one trailing dot, keeping the port", () => {
    expect(normaliseHost(" Acme.Localhost.:3000 ")).toBe("acme.localhost:3000");
    expect(normaliseHost("acme.shiftdesk.co.uk.")).toBe("acme.shiftdesk.co.uk");
  });

  it("isValidSlug matches the slug rules", () => {
    expect(isValidSlug("acme")).toBe(true);
    expect(isValidSlug("northline-rail")).toBe(true);
    for (const bad of ["a", "-a", "a-", "A1", "www", "xn--abc", "a".repeat(21)]) {
      expect(isValidSlug(bad)).toBe(false);
    }
  });
});
