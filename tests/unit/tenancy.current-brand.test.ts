import { DynamicServerError } from "next/dist/client/components/hooks-server-context";
import { notFound } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The layout's brand lookup (src/lib/tenancy/current-brand.ts): a real failure (the database
// briefly down) is logged and the page still draws; Next's own signals (a build-time render reading
// the request's headers, a not-found, a redirect) go back to Next untouched (audit L83: every
// `next build` logged about 30 of them as errors).

const findCurrentFirm = vi.fn();
const firmBrand = vi.fn();
const logged: unknown[] = [];

vi.mock("@/lib/tenancy/current-firm", () => ({ findCurrentFirm: () => findCurrentFirm() }));
vi.mock("@/lib/tenancy/brand", async (original) => ({
  ...(await original<typeof import("@/lib/tenancy/brand")>()),
  firmBrand: () => firmBrand(),
}));
vi.mock("@/lib/log", () => ({
  log: { error: (...args: unknown[]) => logged.push(args), info: () => {}, warn: () => {} },
}));

// A fresh module each time: getCurrentBrand is cached per render.
const brand = async () => (await import("@/lib/tenancy/current-brand")).getCurrentBrand();

beforeEach(() => {
  vi.resetModules();
  findCurrentFirm.mockReset();
  firmBrand.mockReset();
  logged.length = 0;
});

const nextSignal = (): unknown => {
  try {
    notFound();
  } catch (err) {
    return err;
  }
  throw new Error("notFound() didn't throw");
};

describe("the brand lookup", () => {
  it("Next's own signal goes back to Next, and isn't logged as a failure", async () => {
    const signal = nextSignal();
    findCurrentFirm.mockRejectedValue(signal);
    await expect(brand()).rejects.toBe(signal);
    expect(logged).toEqual([]);
  });

  // The one audit L83 saw: `next build` rendering a page that reads the request's headers.
  it("the build's dynamic-rendering signal goes back to Next too", async () => {
    const signal = new DynamicServerError("Route / couldn't be rendered statically: headers()");
    findCurrentFirm.mockRejectedValue(signal);
    await expect(brand()).rejects.toBe(signal);
    expect(logged).toEqual([]);
  });

  it("a real failure finding the firm: logged, and no bar", async () => {
    findCurrentFirm.mockRejectedValue(new Error("connection reset"));
    expect(await brand()).toBeNull();
    expect(logged).toHaveLength(1);
  });

  it("the firm found but its brand unreadable: its name in the default colours, logged", async () => {
    findCurrentFirm.mockResolvedValue({ id: "f1", name: "Acme Events" });
    firmBrand.mockRejectedValue(new Error("connection reset"));
    expect(await brand()).toMatchObject({ name: "Acme Events", logoUrl: null, own: false });
    expect(logged).toHaveLength(1);
  });
});
