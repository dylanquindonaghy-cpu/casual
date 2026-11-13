import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "@/lib/auth/sessions";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { waveCandidates } from "@/lib/offers/candidates";
import { officeOfferPage } from "@/lib/office/offer-page";
import { bookingFirm, hoursFromNow, NOW } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// The office's offer list, round 8 (Phase 26.9, off-1, off-2 and off-5; docs/screens.md "Offering a
// shift"): each person who can be offered the session with how the offer will reach them and why,
// and the firm's other casuals with the role under "Not offered, and why", each with one reason.
// On the real database, as the app role. Tests have a text sender (console), so "By text" is
// possible. NOW is Monday 2 November 2026, 09:00 London (GMT).

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

describe("who can be offered it, how, and who can't and why", () => {
  it("each way an offer reaches someone, and each reason someone isn't offered it", async () => {
    const f = await bookingFirm(su, withFirm);
    const resourcer = await f.office("resourcer");
    // Tuesday 15:00, not urgent; two places, so Fay's booking leaves one to offer.
    const shiftId = await f.shift({ startsAt: hoursFromNow(30), headcount: 2 });
    const set = (id: string, sql: string, values: unknown[] = []) =>
      su.query(`update workers set ${sql} where id = $1`, [id, ...values]);
    // Who can be offered it:
    const ann = await f.worker({ first: "Ann" }); // a phone with notifications on
    await su.query(
      `insert into push_subscriptions (firm_id, worker_id, endpoint, p256dh, auth)
       values ($1, $2, 'https://push.example.test/ann', 'k', 'a')`,
      [f.firmId, ann],
    );
    const ben = await f.worker({ first: "Ben" }); // chose email
    await set(ben, "email = $2, notify_channel = 'email'", ["ben@example.test"]);
    const cat = await f.worker({ first: "Cat" }); // replied STOP, an address held
    await set(cat, "email = $2, sms_opted_out_at = $3", ["cat@example.test", hoursFromNow(-5)]);
    const eve = await f.worker({ first: "Eve" }); // texts, the default
    // Who can't, and why:
    const dan = await f.worker({ first: "Dan" }); // replied STOP, no address: nothing reaches him
    await set(dan, "sms_opted_out_at = $2", [hoursFromNow(-5)]);
    const fay = await f.worker({ first: "Fay" }); // booked on it
    await f.booking(fay, shiftId);
    const gus = await f.worker({ first: "Gus" }); // turned offers off
    await set(gus, "offer_alerts = false");
    const hal = await f.worker({ first: "Hal", credentials: [{ type: "STEWARD_L2" }] }); // no SIA
    const ivy = await f.worker({ first: "Ivy" }); // 3 offers today already
    for (let i = 0; i < 3; i++) {
      const other = await f.shift({ startsAt: hoursFromNow(80 + i * 24) });
      await su.query(
        `insert into offers (firm_id, shift_id, worker_id, wave, channel, sent_at)
         values ($1, $2, $3, 1, 'sms', $4)`,
        [f.firmId, other, ivy, hoursFromNow(-1)],
      );
    }
    // Not the role: not listed at all.
    await f.worker({ first: "Kim", roles: ["steward"] });
    // Another firm's door supervisor, with a phone: never in this firm's lists, nor counted.
    const other = await bookingFirm(su, withFirm);
    const stranger = await other.worker({ first: "Ann" });
    await su.query(
      `insert into push_subscriptions (firm_id, worker_id, endpoint, p256dh, auth)
       values ($1, $2, 'https://push.example.test/stranger', 'k', 'a')`,
      [other.firmId, stranger],
    );

    const token = (
      await withFirm(f.firmId, (tx) =>
        createSession(tx, { kind: "office", subjectId: resourcer, now: NOW }),
      )
    ).token;
    const page = await officeOfferPage(
      { firm: { id: f.firmId }, run: withFirm, clock: { now: () => NOW } },
      token,
      shiftId,
    );
    if (!page) throw new Error("no page");
    const reach = Object.fromEntries(page.candidates.map((c) => [c.workerId, c.reach]));
    expect(reach).toEqual({
      [ann]: { how: "push" },
      [ben]: { how: "email", why: "chose_email" },
      [cat]: { how: "email", why: "texts_off" },
      [eve]: { how: "sms" },
    });
    expect(page.candidates.every((c) => c.outsideArea === false)).toBe(true);
    expect(page.notOffered.map((n) => [n.name, n.why])).toEqual([
      ["Dan Booker", "unreachable"],
      ["Fay Booker", "booked"],
      ["Gus Booker", "offers_off"],
      ["Hal Booker", "licence"],
      ["Ivy Booker", "cap"],
    ]);
    expect(page.notOffered.find((n) => n.why === "licence")?.workerId).toBe(hal);
    // The card, by the firm's own name (Phase 37.3): Hal holds no SIA licence at all.
    expect(page.notOffered.find((n) => n.workerId === hal)?.licence).toEqual({
      names: ["SIA door supervisor licence"],
      state: "missing",
      date: null,
      year: 2026,
    });
    // Only "licence" carries the card.
    expect(page.notOffered.filter((n) => n.licence).map((n) => n.workerId)).toEqual([hal]);
    expect(page.notOfferedMore).toBe(0);
    // Every casual with the role is in one list or the other, once.
    const listed = [
      ...page.candidates.map((c) => c.workerId),
      ...page.notOffered.map((n) => n.workerId),
    ];
    expect(new Set(listed).size).toBe(listed.length);
    expect(listed).toHaveLength(9);
    expect(listed).not.toContain(stranger);
  });

  // "Not offered, and why" names the card (Phase 37.3, w1-03): the first card the rules found, its
  // state and date, by this firm's own name for it. Another firm's name for the same code never
  // shows (credential_types is read inside withFirm).
  it("a licence or card: the session's extra card, a licence out of date, and the firm's names", async () => {
    const f = await bookingFirm(su, withFirm);
    const other = await bookingFirm(su, withFirm);
    await su.query(
      `update credential_types set name = 'Other firm door badge' where firm_id = $1 and code = 'SIA_DS'`,
      [other.firmId],
    );
    await su.query(
      `update credential_types set name = 'Other firm lifting card' where firm_id = $1 and code = 'MANUAL_HANDLING'`,
      [other.firmId],
    );
    const resourcer = await f.office("resourcer");
    const token = (
      await withFirm(f.firmId, (tx) =>
        createSession(tx, { kind: "office", subjectId: resourcer, now: NOW }),
      )
    ).token;
    const page = (shiftId: string) =>
      officeOfferPage(
        { firm: { id: f.firmId }, run: withFirm, clock: { now: () => NOW } },
        token,
        shiftId,
      );
    // Lee: a valid licence, but no manual handling certificate, which this session asks for.
    const lee = await f.worker({ first: "Lee" });
    // Mo: his licence ran out on 7 Oct, before NOW (Mon 2 Nov 2026).
    const mo = await f.worker({
      first: "Mo",
      credentials: [{ type: "SIA_DS", expiresOn: "2026-10-07" }],
    });
    // The other firm's door supervisor without either card: never in this list.
    const stranger = await other.worker({ first: "Lee", credentials: [] });

    const plain = await page(await f.shift({ startsAt: hoursFromNow(30) }));
    if (!plain) throw new Error("no page");
    expect(plain.candidates.map((c) => c.workerId)).toEqual([lee]);
    expect(plain.notOffered.map((n) => [n.workerId, n.licence])).toEqual([
      [
        mo,
        {
          names: ["SIA door supervisor licence"],
          state: "out_of_date",
          date: "2026-10-07",
          year: 2026,
        },
      ],
    ]);

    const handling = await f.shift({ startsAt: hoursFromNow(54) });
    await su.query(`update shifts set required_credentials = '{MANUAL_HANDLING}' where id = $1`, [
      handling,
    ]);
    const extra = await page(handling);
    if (!extra) throw new Error("no page");
    expect(extra.candidates).toEqual([]);
    const byId = Object.fromEntries(extra.notOffered.map((n) => [n.workerId, n.licence]));
    // Mo's licence is the first card the rules found, so it's the one named.
    expect(byId).toEqual({
      [lee]: { names: ["manual handling certificate"], state: "missing", date: null, year: 2026 },
      [mo]: {
        names: ["SIA door supervisor licence"],
        state: "out_of_date",
        date: "2026-10-07",
        year: 2026,
      },
    });
    const text = JSON.stringify([plain, extra]);
    expect(text).not.toContain("Other firm");
    expect(text).not.toContain(stranger);
  });

  // The offer waves (M2 of the 26.9 guardrails review): no place for someone nothing can reach.
  it("an offer wave leaves out someone nothing can reach; the office's list shows them instead", async () => {
    const f = await bookingFirm(su, withFirm);
    const shiftId = await f.shift({ startsAt: hoursFromNow(30) });
    const ann = await f.worker({ first: "Ann" }); // a phone with notifications on
    await su.query(
      `insert into push_subscriptions (firm_id, worker_id, endpoint, p256dh, auth)
       values ($1, $2, 'https://push.example.test/ann2', 'k', 'a')`,
      [f.firmId, ann],
    );
    const ben = await f.worker({ first: "Ben" }); // an address held
    await su.query("update workers set email = 'ben2@example.test' where id = $1", [ben]);
    const dan = await f.worker({ first: "Dan" }); // STOP, nothing else
    await su.query("update workers set sms_opted_out_at = $2 where id = $1", [
      dan,
      hoursFromNow(-5),
    ]);
    const eve = await f.worker({ first: "Eve" }); // texts only
    const ids = (o: Parameters<typeof waveCandidates>[3]) =>
      withFirm(f.firmId, async (tx) =>
        (await waveCandidates(tx, shiftId, NOW, o)).map((c) => c.workerId).sort(),
      );
    // The office's offer (no `reachable`): everyone the rules allow.
    expect(await ids({})).toEqual([ann, ben, dan, eve].sort());
    // A wave with a text sender: not Dan.
    expect(await ids({ reachable: { texts: true } })).toEqual([ann, ben, eve].sort());
    // A wave with no text sender: only a phone or an address reaches them.
    expect(await ids({ reachable: { texts: false } })).toEqual([ann, ben].sort());
  });

  // Every other reason, and the first that applies when two do (the claims-auditor's round 1).
  it("each other reason someone isn't offered it, the first that applies, and a role with no rule", async () => {
    const f = await bookingFirm(su, withFirm);
    const resourcer = await f.office("resourcer");
    // Tuesday 15:00 to 23:00, not urgent; two places, so one booking elsewhere leaves room.
    const shiftId = await f.shift({ startsAt: hoursFromNow(30), headcount: 2 });
    // At a venue, so a block from it can apply.
    const { rows: at } = await su.query<{ id: string }>(
      "insert into sites (firm_id, name) values ($1, 'Reach Arena') returning id::text",
      [f.firmId],
    );
    const siteId = at[0]?.id;
    if (!siteId) throw new Error("no site");
    await su.query("update shifts set site_id = $2 where id = $1", [shiftId, siteId]);
    const offerOf = (workerId: string, onShift: string) =>
      su.query(
        `insert into offers (firm_id, shift_id, worker_id, wave, channel, sent_at)
         values ($1, $2, $3, 1, 'sms', $4)`,
        [f.firmId, onShift, workerId, hoursFromNow(-30)],
      );
    const jo = await f.worker({ first: "Jo" }); // cancelled off it
    await f.booking(jo, shiftId, "cancelled_worker", 2);
    const kit = await f.worker({ first: "Kit" }); // already offered it
    await offerOf(kit, shiftId);
    const lou = await f.worker({ first: "Lou" }); // booked elsewhere then (Tue 17:00)
    await f.booking(lou, await f.shift({ startsAt: hoursFromNow(32) }));
    const max = await f.worker({ first: "Max" }); // ends 10:00 Tue: 5 hours before, 11 needed
    await f.booking(max, await f.shift({ startsAt: hoursFromNow(17) }));
    const ned = await f.worker({ first: "Ned" }); // 48 hours booked from Thursday to Sunday
    for (const start of [72, 96, 120, 144]) {
      await f.booking(ned, await f.shift({ startsAt: hoursFromNow(start), hours: 12 }));
    }
    const oli = await f.worker({ first: "Oli" }); // marked Tuesday unavailable
    await su.query(
      "insert into worker_unavailable_days (firm_id, worker_id, day) values ($1, $2, '2026-11-03')",
      [f.firmId, oli],
    );
    const pam = await f.worker({ first: "Pam" }); // blocked from the site
    await su.query(
      "insert into worker_site_blocks (firm_id, worker_id, site_id, reason) values ($1, $2, $3, 'incident')",
      [f.firmId, pam, siteId],
    );
    // Two reasons: the first that applies.
    const rex = await f.worker({ first: "Rex" }); // offers off, and booked elsewhere then
    await su.query("update workers set offer_alerts = false where id = $1", [rex]);
    await f.booking(rex, await f.shift({ startsAt: hoursFromNow(31) }));
    const sue = await f.worker({ first: "Sue" }); // cancelled off it, and offered it before
    await f.booking(sue, shiftId, "cancelled_worker", 2);
    await offerOf(sue, shiftId);
    const tom = await f.worker({ first: "Tom" }); // free: offered as usual

    const ctx = { firm: { id: f.firmId }, run: withFirm, clock: { now: () => NOW } };
    const token = (
      await withFirm(f.firmId, (tx) =>
        createSession(tx, { kind: "office", subjectId: resourcer, now: NOW }),
      )
    ).token;
    const page = await officeOfferPage(ctx, token, shiftId);
    if (!page) throw new Error("no page");
    expect(page.candidates.map((c) => c.workerId)).toEqual([tom]);
    expect(Object.fromEntries(page.notOffered.map((n) => [n.workerId, n.why]))).toEqual({
      [jo]: "cancelled",
      [kit]: "offered",
      [lou]: "elsewhere",
      [max]: "rest",
      [ned]: "hours",
      [oli]: "unavailable",
      [pam]: "blocked",
      [rex]: "offers_off",
      [sue]: "cancelled",
    });

    // A role with no rule for it: nobody can be offered it, each says why.
    const lifeguard = await f.worker({ first: "Uma", roles: ["lifeguard"] });
    const noRule = await f.shift({ role: "lifeguard", startsAt: hoursFromNow(30) });
    const unruled = await officeOfferPage(ctx, token, noRule);
    expect(unruled?.candidates).toEqual([]);
    expect(unruled?.notOffered.map((n) => [n.workerId, n.why])).toEqual([[lifeguard, "no_rule"]]);
  });

  it("an urgent session isn't held to the day's offers; more than 20 left out are counted", async () => {
    const f = await bookingFirm(su, withFirm);
    const resourcer = await f.office("resourcer");
    const shiftId = await f.shift({ startsAt: hoursFromNow(30) });
    await su.query("update shifts set is_urgent = true where id = $1", [shiftId]);
    const busy = await f.worker({ first: "Ivy" });
    for (let i = 0; i < 3; i++) {
      const other = await f.shift({ startsAt: hoursFromNow(80 + i * 24) });
      await su.query(
        `insert into offers (firm_id, shift_id, worker_id, wave, channel, sent_at)
         values ($1, $2, $3, 1, 'sms', $4)`,
        [f.firmId, other, busy, hoursFromNow(-1)],
      );
    }
    for (let i = 0; i < 22; i++) {
      const id = await f.worker({ first: `Off${String(i).padStart(2, "0")}` });
      await su.query("update workers set offer_alerts = false where id = $1", [id]);
    }
    const token = (
      await withFirm(f.firmId, (tx) =>
        createSession(tx, { kind: "office", subjectId: resourcer, now: NOW }),
      )
    ).token;
    const page = await officeOfferPage(
      { firm: { id: f.firmId }, run: withFirm, clock: { now: () => NOW } },
      token,
      shiftId,
    );
    expect(page?.candidates.map((c) => c.workerId)).toEqual([busy]);
    expect(page?.notOffered).toHaveLength(20);
    expect(page?.notOfferedMore).toBe(2);
    expect(page?.notOffered.every((n) => n.why === "offers_off")).toBe(true);
  });
});
