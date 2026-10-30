import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { NeedsAttention } from "@/lib/office/dashboard";

// Needs attention's page (Phase 25.3, P4's "Needs attention worked out once a request"): its items
// and count are the office frame's (src/app/office/frame.ts: the layout's one reading, kept for the
// request by React's cache), never read again; only its urgent places are its own.

const needs: NeedsAttention = {
  toCheck: [],
  toCheckTotal: 0,
  fromSheet: [],
  fromSheetTotal: 0,
  toMark: [],
  toMarkTotal: 0,
  expired: [],
  expiredTotal: 0,
  uploads: 3,
  uploadList: [],
  evidence: { addressConfirmed: true, waiting: 0, failed: [], failedTotal: 0 },
  plannerRefused: [],
  plannerRefusedTotal: 0,
  webhookFailing: null,
  sheetNames: [],
  sheetNamesTotal: 0,
};

const officeFrame = vi.fn(async () => ({
  session: {},
  frame: {
    payQueries: null,
    uploads: { ok: true, data: 3 },
    needPerson: { ok: true, data: 2 },
    needs: { timeZone: "Europe/London", today: "2026-11-02", needs: { ok: true, data: needs } },
    shell: null,
  },
}));
const loadNeedsAttention = vi.fn(async () => {
  throw new Error("Needs attention read again");
});
const officeUrgentCount = vi.fn(async () => ({
  ok: true as const,
  data: { sessions: 1, places: 2, firstStartsAt: new Date("2026-11-02T14:00:00Z") },
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not found");
  },
  redirect: () => {
    throw new Error("redirected");
  },
  useRouter: () => ({ refresh: () => undefined }),
}));
vi.mock("@/lib/auth/current-office", () => ({
  requireOfficeArea: async () => ({
    firm: { id: "11111111-1111-4111-8111-111111111111", name: "Acme" },
    officeUser: { id: "22222222-2222-4222-8222-222222222222", role: "admin" },
  }),
}));
vi.mock("@/app/office/frame", () => ({ officeFrame }));
vi.mock("@/lib/office/dashboard", async (original) => ({
  ...(await original<typeof import("@/lib/office/dashboard")>()),
  loadNeedsAttention,
  officeUrgentCount,
}));
vi.mock("@/app/office/shifts/actions", () => ({
  setShowingAction: vi.fn(),
  cancelBookingAction: vi.fn(),
  cancelShiftAction: vi.fn(),
  moveShiftAction: vi.fn(),
}));

const { default: NeedsAttentionPage } = await import("@/app/office/needs-attention/page");

const words = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

describe("Needs attention's page", () => {
  it("shows the frame's items and count; reads only its urgent places itself", async () => {
    const html = renderToStaticMarkup(await NeedsAttentionPage());
    // The frame's 3 uploads and 2 enquiries: 5 things.
    expect(words(html)).toContain("5 things for you.");
    expect(words(html)).toContain("3 uploads wait for a check.");
    expect(officeFrame).toHaveBeenCalledTimes(1);
    expect(loadNeedsAttention).not.toHaveBeenCalled();
    expect(officeUrgentCount).toHaveBeenCalledTimes(1);
  });
});
