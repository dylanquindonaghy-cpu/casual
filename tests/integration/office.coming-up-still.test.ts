import type { Pool } from "pg";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { loadComingUp, type ComingUp } from "@/lib/office/coming-up";
import { moveShift } from "@/lib/office/quick-actions";
import { loadCasualRecords } from "@/lib/office/reliability";
import { myShifts } from "@/lib/portal/my-shifts";
import { shiftForWorker } from "@/lib/portal/shift-detail";
import { confirmStillComing } from "@/lib/portal/still-coming";
import { bookingFirm, hoursFromNow, NOW, type BookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// "Still coming?" (Phase 28.14; docs/screens.md "The casual app, Phase 28" 28.14) on the real
// database, as the app role. The casual's side: the card on her booked shift's page shows from 24
// hours before the start until the start and not otherwise; "Yes, I'm coming" sets the time and
// logs once; a second tap shows the same answer. The office's side: Coming up shows "Coming" with
// the time for a casual who answered and "Not answered yet" for the others within 24 hours; where
// the firm's own system sends the reminders it shows nothing for a booking of that system's that
// wasn't answered; another firm's casual never shows; and answering changes nothing else (the watch
// list, first shift, licence and asked flags, the reliability record, strikes, requests, events).
// NOW is Monday 2 November 2026, 09:00 London (GMT).

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace() {}, refresh() {} }) }));
const { ShiftView } = await import("@/app/shifts/[id]/shift-view");
const { NextPass } = await import("@/app/next-pass");

const TZ = "Europe/London";
let su: Pool;
let app: Pool;
let withFirm: WithFirm;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(3);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

const ctx = (f: BookingFirm, now = NOW) => ({
  firm: { id: f.firmId },
  run: withFirm,
  clock: { now: () => now },
});

const load = (f: BookingFirm, now = NOW) =>
  withFirm(f.firmId, (tx) => loadComingUp(tx, now, TZ, null));

const set = (table: string, id: string, cells: Record<string, unknown>) =>
  su.query(
    `update ${table} set ${Object.keys(cells)
      .map((k, i) => `${k} = $${i + 2}`)
      .join(", ")} where id = $1`,
    [id, ...Object.values(cells)],
  );

// A record: `noShows` sessions marked as not attended, then `worked` marked as worked, a week apart
// (as the watch list's own tests make one).
async function record(f: BookingFirm, workerId: string, worked: number, noShows = 0) {
  for (let i = 0; i < worked + noShows; i++) {
    const s = await f.shift({ role: "steward", startsAt: hoursFromNow(-(i * 7 + 1) * 24) });
    await f.booking(workerId, s, i < noShows ? "no_show" : "completed");
  }
}

// A firm on Monday 2 Nov, 09:00:
// - tonight at 19:00 (in 10 hours, 4 places): Ann and Ben (the office's bookings), Cia (booked by
//   the firm's rota sheet) and Dan (booked through the firm's planner API);
// - tomorrow at 15:00 (in 30 hours): Eve;
// - one under way since 07:00: Fay, and Gil (who said yes before it started).
async function scene(settings: Record<string, unknown> = {}) {
  const f = await bookingFirm(su, withFirm, { settings });
  const people = async (...names: string[]) =>
    Promise.all(names.map((first) => f.worker({ first })));
  const [ann, ben, cia, dan, eve, fay, gil] = await people(
    "Ann",
    "Ben",
    "Cia",
    "Dan",
    "Eve",
    "Fay",
    "Gil",
  );
  const tonight = await f.shift({ startsAt: hoursFromNow(10), headcount: 4 });
  const tomorrow = await f.shift({ startsAt: hoursFromNow(30) });
  const underway = await f.shift({ startsAt: hoursFromNow(-2), headcount: 2 });
  const booking = {
    ann: await f.booking(ann!, tonight, "confirmed", 1),
    ben: await f.booking(ben!, tonight, "confirmed", 2),
    cia: await f.booking(cia!, tonight, "confirmed", 3),
    dan: await f.booking(dan!, tonight, "confirmed", 4),
    eve: await f.booking(eve!, tomorrow),
    fay: await f.booking(fay!, underway, "confirmed", 1),
    gil: await f.booking(gil!, underway, "confirmed", 2),
  };
  await set("assignments", booking.cia, { booked_via: "sheet" });
  await set("assignments", booking.dan, { booked_via: "api" });
  await set("assignments", booking.gil, { still_coming_at: hoursFromNow(-3) });
  return {
    f,
    ann: ann!,
    ben: ben!,
    cia: cia!,
    dan: dan!,
    eve: eve!,
    fay: fay!,
    gil: gil!,
    tonight,
    tomorrow,
    underway,
    booking,
  };
}

// Each person's mark, by name: "coming HH:MM" (London), "waiting", or "-".
const marks = (c: ComingUp) =>
  Object.fromEntries(
    c.sessions.flatMap((s) =>
      s.people.map((p) => {
        const m = p.stillComing;
        const said = m?.kind === "coming" ? m.at.toISOString() : null;
        return [p.name, m?.kind === "coming" ? `coming ${said}` : (m?.kind ?? "-")];
      }),
    ),
  );

describe("the casual's card on her booked shift's page", () => {
  async function card(f: BookingFirm, workerId: string, shiftId: string, now: Date) {
    const page = await shiftForWorker(ctx(f, now), workerId, shiftId);
    return renderToStaticMarkup(createElement(ShiftView, { page, timeZone: TZ, now }));
  }

  it("shows from 24 hours before the start until the start, and not otherwise", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const starts = hoursFromNow(30);
    const shift = await f.shift({ startsAt: starts });
    await f.booking(sam, shift);
    const before = (ms: number) => new Date(starts.getTime() - ms);
    const HOUR = 3_600_000;
    // 25 hours before, and a minute more than 24: no card.
    for (const now of [before(25 * HOUR), before(24 * HOUR + 60_000)]) {
      const html = await card(f, sam, shift, now);
      expect(html).not.toContain("data-still-coming");
      expect(text(html)).not.toContain("Still coming?");
      // "Can't make it?" stays where it always is, beside "Ask for a change".
      expect(text(html)).toContain("Can't make it?");
    }
    // Exactly 24 hours before, an hour before, a minute before: the card, online only.
    for (const now of [before(24 * HOUR), before(HOUR), before(60_000)]) {
      const html = await card(f, sam, shift, now);
      expect(html).toMatch(/<section data-online-only="" data-still-coming=""/);
      expect(text(html)).toContain("Still coming? Yes, I'm coming Can't make it?");
      expect(html.match(/>Can&#x27;t make it\?</g)).toHaveLength(1);
    }
    // At the start, and once it has started: no card, and nothing to cancel.
    for (const now of [starts, new Date(starts.getTime() + HOUR)]) {
      const html = await card(f, sam, shift, now);
      expect(html).not.toContain("data-still-coming");
      expect(text(html)).not.toContain("Can't make it?");
    }
    // A cancelled shift: never.
    await set("shifts", shift, { status: "cancelled" });
    expect(await card(f, sam, shift, before(HOUR))).not.toContain("data-still-coming");
  });

  it("'Yes, I'm coming' sets the time and logs once; a second tap shows the same answer", async () => {
    const f = await bookingFirm(su, withFirm);
    const sam = await f.worker();
    const shift = await f.shift({ startsAt: hoursFromNow(10) });
    const booking = await f.booking(sam, shift);
    expect(await confirmStillComing(ctx(f), sam, shift)).toEqual({ status: "confirmed", at: NOW });
    const later = new Date(NOW.getTime() + 15 * 60_000);
    expect(await confirmStillComing(ctx(f, later), sam, shift)).toEqual({
      status: "already",
      at: NOW,
    });
    const { rows: said } = await su.query<{ at: Date }>(
      "select still_coming_at as at from assignments where id = $1",
      [booking],
    );
    expect(said[0]?.at).toEqual(NOW);
    const { rows: logged } = await su.query<{ n: number }>(
      "select count(*)::int as n from events where firm_id = $1 and action = 'shift.still_coming'",
      [f.firmId],
    );
    expect(logged[0]?.n).toBe(1);
    // The page and the pass now read "You said you're coming (Mon 09:00)", with no button.
    const html = await card(f, sam, shift, later);
    expect(text(html)).toContain("Still coming? You said you're coming (Mon 09:00) Can't make it?");
    expect(text(html)).not.toContain("Yes, I'm coming");
    const [next] = await myShifts(ctx(f, later), sam, "upcoming");
    expect(next?.stillComingAt).toEqual(NOW);
    const pass = renderToStaticMarkup(
      createElement(NextPass, { shift: next!, timeZone: TZ, now: later }),
    );
    expect(pass).toMatch(/<section data-online-only="" data-still-coming=""/);
    expect(text(pass)).toContain("You said you're coming (Mon 09:00)");
  });
});

describe("Coming up: 'Coming' or 'Not answered yet' (Phase 28.14)", () => {
  it("'Coming' with the time for who answered, 'Not answered yet' for the others within 24 hours", async () => {
    const t = await scene();
    const later = new Date(NOW.getTime() + 2 * 60_000);
    await confirmStillComing(ctx(t.f), t.ann, t.tonight);
    await confirmStillComing(ctx(t.f), t.dan, t.tonight);
    // Eve's is 30 hours away: too early to say, and too early to be waiting.
    expect(await confirmStillComing(ctx(t.f), t.eve, t.tomorrow)).toEqual({ status: "not_now" });
    expect(marks(await load(t.f, later))).toEqual({
      "Fay Booker": "-", // under way, never answered: nothing to ask now
      "Gil Booker": `coming ${hoursFromNow(-3).toISOString()}`, // said so before it started
      "Ann Booker": `coming ${NOW.toISOString()}`,
      "Ben Booker": "waiting",
      "Cia Booker": "waiting", // the firm doesn't send its own reminders: ShiftDesk reminded her
      "Dan Booker": `coming ${NOW.toISOString()}`,
      "Eve Booker": "-", // more than 24 hours away
    });
  });

  it("where the firm's own system sends the reminders, nothing shows for its bookings unless answered", async () => {
    const t = await scene({ firm_system_sends: true });
    await confirmStillComing(ctx(t.f), t.dan, t.tonight);
    const m = marks(await load(t.f));
    // Cia (the sheet's booking) got no ShiftDesk reminder: nothing. Dan (the planner's) answered
    // anyway: "Coming". Ann and Ben are the office's own bookings: ShiftDesk reminds them.
    expect(m["Cia Booker"]).toBe("-");
    expect(m["Dan Booker"]).toBe(`coming ${NOW.toISOString()}`);
    expect(m["Ann Booker"]).toBe("waiting");
    expect(m["Ben Booker"]).toBe("waiting");
  });

  it("another firm's casual never shows, answered or not", async () => {
    const mine = await scene();
    const theirs = await scene();
    await confirmStillComing(ctx(theirs.f), theirs.ann, theirs.tonight);
    // Their casual can't answer for a shift of ours either.
    expect(await confirmStillComing(ctx(mine.f), theirs.ben, mine.tonight)).toEqual({
      status: "not_now",
    });
    const c = await load(mine.f);
    const ids = c.sessions.flatMap((s) => s.people.map((p) => p.workerId));
    for (const id of [theirs.ann, theirs.ben, theirs.cia, theirs.dan]) {
      expect(ids).not.toContain(id);
    }
    expect(c.sessions.map((s) => s.shiftId)).not.toContain(theirs.tonight);
    expect(marks(c)["Ann Booker"]).toBe("waiting");
  });

  it("answering changes nothing else: the watch list and every other flag, the record, strikes, requests, events", async () => {
    const t = await scene();
    // Ann on the watch list (4 worked, 2 not attended: 66%); Ben with a good record.
    await record(t.f, t.ann, 4, 2);
    await record(t.f, t.ben, 5);
    const others = (c: ComingUp) =>
      c.sessions.flatMap((s) =>
        s.people.map((p) => ({
          shift: s.shiftId,
          worker: p.workerId,
          watch: p.watch,
          firstShift: p.firstShift,
          licence: p.licence,
          asked: p.asked,
        })),
      );
    const counts = async () =>
      (
        await su.query<{ action: string; n: number }>(
          `select action, count(*)::int as n from events where firm_id = $1
            group by action order by action`,
          [t.f.firmId],
        )
      ).rows;
    const side = async () =>
      (
        await su.query<{ strikes: number; requests: number; offered: number }>(
          `select (select count(*)::int from strikes where firm_id = $1) as strikes,
                  (select count(*)::int from requests where firm_id = $1) as requests,
                  (select count(*)::int from assignments where firm_id = $1 and status = 'offered')
                    as offered`,
          [t.f.firmId],
        )
      ).rows[0];
    const reliability = async () =>
      withFirm(t.f.firmId, (tx) =>
        loadCasualRecords(tx, NOW, [t.ann, t.ben, t.cia, t.dan, t.eve, t.fay, t.gil]),
      );

    const before = await load(t.f);
    const eventsBefore = await counts();
    const sideBefore = await side();
    const recordsBefore = await reliability();
    expect(before.sessions.flatMap((s) => s.people).find((p) => p.workerId === t.ann)?.watch).toBe(
      true,
    );

    for (const w of [t.ann, t.ben, t.cia, t.dan]) {
      expect(await confirmStillComing(ctx(t.f), w, t.tonight)).toMatchObject({
        status: "confirmed",
      });
    }
    const after = await load(t.f);
    // Every flag but the answer is the same, the watch list included.
    expect(others(after)).toEqual(others(before));
    expect(after.total).toBe(before.total);
    expect(after.people).toBe(before.people);
    expect(after.sessions.map((s) => [s.booked, s.placesToOffer])).toEqual(
      before.sessions.map((s) => [s.booked, s.placesToOffer]),
    );
    // The record behind reliability and the watch list is untouched.
    expect(await reliability()).toEqual(recordsBefore);
    // No strike, no request, no new offer.
    expect(await side()).toEqual(sideBefore);
    // Only the four answers were logged.
    const eventsAfter = await counts();
    const delta = Object.fromEntries(
      eventsAfter.map((e) => [
        e.action,
        e.n - (eventsBefore.find((b) => b.action === e.action)?.n ?? 0),
      ]),
    );
    expect(Object.entries(delta).filter(([, n]) => n !== 0)).toEqual([["shift.still_coming", 4]]);
  });
});

describe("a move clears the answer: she's asked again for the new time or place (28.14)", () => {
  it("new times, then a new site: Coming up shows 'Not answered yet' and her card offers 'Yes, I'm coming' again", async () => {
    const f = await bookingFirm(su, withFirm);
    const resourcer = await f.office("resourcer");
    const { rows: sites } = await su.query<{ id: string }>(
      "insert into sites (firm_id, name) values ($1, 'Riverside Arena'), ($1, 'Other Stadium') returning id::text as id",
      [f.firmId],
    );
    const [arena = "", stadium = ""] = sites.map((r) => r.id);
    const ann = await f.worker({ first: "Ann" });
    const ben = await f.worker({ first: "Ben" });
    const eve = await f.worker({ first: "Eve" });
    // Tonight 19:00 to 03:00 at the arena (Ann and Ben); this afternoon at 14:00 (Eve).
    const tonight = await f.shift({ startsAt: hoursFromNow(10), headcount: 2 });
    await set("shifts", tonight, { site_id: arena });
    const afternoon = await f.shift({ startsAt: hoursFromNow(5) });
    const annBooking = await f.booking(ann, tonight, "confirmed", 1);
    const benBooking = await f.booking(ben, tonight, "confirmed", 2);
    await f.booking(eve, afternoon);
    for (const [w, s] of [
      [ann, tonight],
      [ben, tonight],
      [eve, afternoon],
    ] as const) {
      expect(await confirmStillComing(ctx(f), w, s)).toMatchObject({ status: "confirmed" });
    }
    const office = (when: Date) => ({
      firm: { id: f.firmId },
      officeUserId: resourcer,
      run: withFirm,
      clock: { now: () => when },
    });
    const later = new Date(NOW.getTime() + 30 * 60_000);
    const page = async (when: Date) =>
      text(
        renderToStaticMarkup(
          createElement(ShiftView, {
            page: await shiftForWorker(ctx(f, when), ann, tonight),
            timeZone: TZ,
            now: when,
          }),
        ),
      );
    const movedEvents = async () =>
      (
        await su.query<{ entity_id: string; data: Record<string, unknown> }>(
          `select entity_id::text, data from events where firm_id = $1 and action = 'shift.moved'
            order by id`,
          [f.firmId],
        )
      ).rows;

    // New times: tonight now 17:00 to 23:00 (a move: it starts earlier).
    expect(
      await moveShift(office(later), tonight, {
        date: "2026-11-02",
        start: "17:00",
        end: "23:00",
        siteId: arena,
        reason: "event_changed",
      }),
    ).toMatchObject({ status: "moved" });
    expect(marks(await load(f, later))).toEqual({
      "Eve Booker": `coming ${NOW.toISOString()}`, // another session: her answer stands
      "Ann Booker": "waiting",
      "Ben Booker": "waiting",
    });
    expect(await page(later)).toContain("Still coming? Yes, I'm coming Can't make it?");
    // The move's own log says the answers were cleared; no event of its own.
    const first = await movedEvents();
    expect(first.map((e) => [e.entity_id, e.data.stillComingCleared])).toEqual([
      [annBooking, true],
      [benBooking, true],
    ]);
    // She can answer again, for the new time.
    expect(await confirmStillComing(ctx(f, later), ann, tonight)).toEqual({
      status: "confirmed",
      at: later,
    });
    expect(marks(await load(f, later))["Ann Booker"]).toBe(`coming ${later.toISOString()}`);

    // A new site, same times: cleared again. Ben hadn't answered since: his move says nothing.
    const later2 = new Date(later.getTime() + 30 * 60_000);
    expect(
      await moveShift(office(later2), tonight, {
        date: "2026-11-02",
        start: "17:00",
        end: "23:00",
        siteId: stadium,
        reason: "event_changed",
      }),
    ).toMatchObject({ status: "moved" });
    expect(marks(await load(f, later2))["Ann Booker"]).toBe("waiting");
    const second = (await movedEvents()).slice(2);
    expect(second.map((e) => [e.entity_id, e.data.stillComingCleared ?? null])).toEqual([
      [annBooking, true],
      [benBooking, null],
    ]);
  });
});
