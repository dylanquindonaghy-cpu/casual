import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createSession } from "@/lib/auth/sessions";
import { WORKER_SESSION_COOKIE } from "@/lib/auth/session-cookie";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { calendarForWorker } from "@/lib/portal/calendar";
import { bookingFirm, hoursFromNow, type BookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// GET /shifts/{id}/calendar, "Add to my calendar" (Phase 28.5; docs/api-and-jobs.md "HTTP
// endpoints"; src/app/shifts/[id]/calendar/route.ts), called as Next calls it. The request's host
// and cookies are the only stand-ins (next/headers needs a live request); the firm's directory, her
// session and the booking are read from the real database as the app role. The booked casual gets
// the file (text/calendar, never cached); anyone else, another firm's casual, a cancelled booking
// or session, a made-up id and no session at all get "Not found." alike.

const request = vi.hoisted(() => ({ headers: new Headers(), cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  headers: async () => request.headers,
  cookies: async () => ({
    get: (name: string) => {
      const value = request.cookies.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
}));

const { GET } = await import("@/app/shifts/[id]/calendar/route");

const BASE = "localhost:3000"; // APP_BASE_DOMAIN in the tests (tests/setup/env.ts)
let su: Pool;
let app: Pool;
let withFirm: WithFirm;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(2);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

const slugOf = async (firmId: string) => {
  const { rows } = await su.query<{ slug: string }>("select slug from firms where id = $1", [
    firmId,
  ]);
  return rows[0]?.slug ?? "";
};

// A live session for a casual (as logging in makes one), and the request as her phone sends it.
const sessionFor = async (f: BookingFirm, workerId: string) =>
  (
    await withFirm(f.firmId, (tx) =>
      createSession(tx, { kind: "worker", subjectId: workerId, now: new Date() }),
    )
  ).token;

const on = (host: string, token: string | null) => {
  request.headers = new Headers({ host });
  request.cookies = new Map(token ? [[WORKER_SESSION_COOKIE, token]] : []);
};

const get = (shiftId: string) =>
  GET(new Request(`http://example.invalid/shifts/${shiftId}/calendar`), {
    params: Promise.resolve({ id: shiftId }),
  });

async function scene() {
  const f = await bookingFirm(su, withFirm);
  const slug = await slugOf(f.firmId);
  const ann = await f.worker({ first: "Ann" });
  const ben = await f.worker({ first: "Ben" });
  const shiftId = await f.shift({ startsAt: hoursFromNow(48), headcount: 2 });
  await su.query(
    `update shifts set instructions = 'Door code 4471. Meet at gate C.', pay_rate_pence = 1550,
            meeting_point = 'Staff entrance', uniform = 'Black trousers', post = 'Gate A'
      where id = $1`,
    [shiftId],
  );
  const annBooking = await f.booking(ann, shiftId);
  return { f, slug, ann, ben, shiftId, annBooking };
}

describe("GET /shifts/{id}/calendar", () => {
  it("the booked casual: 200, text/calendar, never cached, her booking's file with the link back", async () => {
    const { f, slug, ann, shiftId, annBooking } = await scene();
    on(`${slug}.${BASE}`, await sessionFor(f, ann));
    const res = await get(shiftId);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="shift-\d{4}-\d{2}-\d{2}\.ics"$/,
    );
    const body = await res.text();
    const lines = body.replace(/\r\n /g, "").split("\r\n");
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines).toContain(`UID:shift-booking-${annBooking}`);
    expect(lines).toContain("SEQUENCE:0");
    expect(lines).toContain(`URL:http://${slug}.${BASE}/shifts/${shiftId}`);
    expect(lines.find((l) => l.startsWith("SUMMARY:"))).toBe(
      `SUMMARY:Door supervisor · Booking Test ${slug}`,
    );
    expect(lines.find((l) => l.startsWith("DTSTART:"))).toMatch(/^DTSTART:\d{8}T\d{6}Z$/);
    // No pay, no instructions, none of the briefing.
    expect(body).not.toMatch(/pay|£|15\.50|1550|door code|gate|staff entrance|trousers/i);
  });

  it("after the office moved her booking: SEQUENCE counts it, the same UID", async () => {
    const { f, slug, ann, shiftId, annBooking } = await scene();
    await su.query(
      `insert into events (firm_id, actor_type, action, entity_type, entity_id, data)
       values ($1, 'office', 'shift.moved', 'assignment', $2, $3)`,
      [f.firmId, annBooking, JSON.stringify({ by: "firm", shiftId, workerId: ann })],
    );
    on(`${slug}.${BASE}`, await sessionFor(f, ann));
    const body = await (await get(shiftId)).text();
    expect(body).toContain("SEQUENCE:1");
    expect(body).toContain(`UID:shift-booking-${annBooking}`);
  });

  it("another casual of the same firm: not found", async () => {
    const { f, slug, ben, shiftId } = await scene();
    on(`${slug}.${BASE}`, await sessionFor(f, ben));
    const res = await get(shiftId);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found.");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("firm B's casual: not found on firm A's address, nor on her own", async () => {
    const { shiftId, slug } = await scene();
    const b = await bookingFirm(su, withFirm);
    const bSlug = await slugOf(b.firmId);
    const zoe = await b.worker({ first: "Zoe" });
    const token = await sessionFor(b, zoe);
    on(`${slug}.${BASE}`, token); // her session isn't firm A's: no session there
    expect((await get(shiftId)).status).toBe(404);
    on(`${bSlug}.${BASE}`, token); // her own firm: A's shift is invisible
    expect((await get(shiftId)).status).toBe(404);
  });

  // Zoe has no booking at firm A, so the cases above would pass on the worker filter alone. These
  // two are about the firm: the booked casual herself, seen from firm B.
  it("Ann's own session on firm B's address: not found (her session is looked up inside the host's firm)", async () => {
    const { f, slug, ann, shiftId } = await scene();
    const b = await bookingFirm(su, withFirm);
    const token = await sessionFor(f, ann);
    on(`${await slugOf(b.firmId)}.${BASE}`, token);
    const res = await get(shiftId);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found.");
    on(`${slug}.${BASE}`, token); // the same session on her own firm's address: her file
    expect((await get(shiftId)).status).toBe(200);
  });

  it("the loader reads inside the firm it's given: in firm B's scope, Ann's booking at firm A is invisible", async () => {
    const { f, ann, shiftId } = await scene();
    const b = await bookingFirm(su, withFirm);
    const ctx = { run: withFirm, baseDomain: BASE, address: "portal" as const };
    // Her own firm: the file, so the null below is the firm's scope and not the arguments.
    expect(await calendarForWorker({ ...ctx, firm: { id: f.firmId } }, ann, shiftId)).not.toBeNull();
    expect(await calendarForWorker({ ...ctx, firm: { id: b.firmId } }, ann, shiftId)).toBeNull();
  });

  it("a cancelled booking, or a cancelled session: not found", async () => {
    const { f, slug, shiftId } = await scene();
    const cal = await f.worker({ first: "Cal" });
    await f.booking(cal, shiftId, "cancelled_worker", 2);
    on(`${slug}.${BASE}`, await sessionFor(f, cal));
    expect((await get(shiftId)).status).toBe(404);

    const { f: g, slug: gSlug, ann, shiftId: gone } = await scene();
    await su.query("update shifts set status = 'cancelled' where id = $1", [gone]);
    on(`${gSlug}.${BASE}`, await sessionFor(g, ann));
    expect((await get(gone)).status).toBe(404);
  });

  it("requires a session: none, or one that has ended, is not found; so is an id that isn't one", async () => {
    const { f, slug, ann, shiftId } = await scene();
    on(`${slug}.${BASE}`, null);
    expect((await get(shiftId)).status).toBe(404);
    const token = await sessionFor(f, ann);
    await su.query("update sessions set revoked_at = now() where worker_id = $1", [ann]);
    on(`${slug}.${BASE}`, token);
    expect((await get(shiftId)).status).toBe(404);
    on(`${slug}.${BASE}`, await sessionFor(f, ann));
    expect((await get("not-a-shift")).status).toBe(404);
    expect((await get("00000000-0000-4000-8000-000000000000")).status).toBe(404);
  });
});
