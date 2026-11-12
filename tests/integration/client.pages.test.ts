import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createSession, findSession } from "@/lib/auth/sessions";
import { SESSION_COOKIES } from "@/lib/auth/session-cookie";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { bookingFirm, type BookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool } from "../helpers/db";

// The client's pages and the office's Client requests and client logins (Phase 36.3, 36.4), through
// their own server actions, the logout route and the pages themselves, on the real database as the
// app role. Only the request's host and cookies stand in (next/headers needs a live request): the
// firm, the client's or office user's session and every row are real. A client sees their own
// contract's events in numbers (never a casual's name), and can't ask about another contract's
// session; logging out ends a client's session and clears its cookie (an office user's and a
// casual's logout as before); the office's answers are for admins and resourcers, client logins for
// admins only.

const request = vi.hoisted(() => ({
  headers: new Headers(),
  cookies: new Map<string, string>(),
  deleted: [] as string[],
}));
vi.mock("next/headers", () => ({
  headers: async () => request.headers,
  cookies: async () => ({
    get: (name: string) => {
      const value = request.cookies.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      request.cookies.set(name, value);
    },
    delete: (o: string | { name: string }) => {
      const name = typeof o === "string" ? o : o.name;
      request.deleted.push(name);
      request.cookies.delete(name);
    },
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
  notFound: () => {
    throw new Error("not found");
  },
  useRouter: () => ({ replace() {}, refresh() {} }),
  usePathname: () => "/client",
}));

const { POST: logoutPost } = await import("@/app/api/logout/route");
const { sendClientRequestAction, replyToQuestionAction } = await import("@/app/client/actions");
const {
  acceptClientRequestAction,
  declineClientRequestAction,
  askClientAction,
  markPlannerDoneAction,
} = await import("@/app/office/client-requests/actions");
const { addClientContactAction, setClientContactOnAction, sendClientLinkAction } = await import(
  "@/app/office/settings/contracts/actions"
);
const { default: ClientEventsPage } = await import("@/app/client/(in)/page");
const { default: ClientEventPage } = await import("@/app/client/(in)/events/[id]/page");

const BASE = "localhost:3000"; // APP_BASE_DOMAIN in the tests (tests/setup/env.ts)
const HOUR = 3_600_000;
const fromNow = (h: number) => new Date(Date.now() + h * HOUR);
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

async function one(text: string, values: unknown[]): Promise<string> {
  const { rows } = await su.query<{ id: string }>(`${text} returning id::text as id`, values);
  const id = rows[0]?.id;
  if (!id) throw new Error(`no id: ${text}`);
  return id;
}

// A firm with two contracts, each with a venue, an event and a session of 4 places in 72 hours (2
// booked on ours, by named casuals); a client login on ours; an admin, a resourcer and payroll.
async function scene() {
  const f: BookingFirm = await bookingFirm(su, withFirm);
  const { rows } = await su.query<{ slug: string }>("select slug from firms where id = $1", [
    f.firmId,
  ]);
  const slug = rows[0]?.slug ?? "";
  const admin = await f.office("admin");
  const resourcer = await f.office("resourcer");
  const payroll = await f.office("payroll");
  const contract = await one("insert into clients (firm_id, name) values ($1, 'Demo Stadium Ltd')", [
    f.firmId,
  ]);
  const venue = await one(
    "insert into sites (firm_id, name, client_id) values ($1, 'Demo Stadium', $2)",
    [f.firmId, contract],
  );
  const event = await one(
    "insert into shift_events (firm_id, name, site_id) values ($1, 'Demo Rovers v Visitors FC', $2)",
    [f.firmId, venue],
  );
  const other = await one("insert into clients (firm_id, name) values ($1, 'Other Venue Ltd')", [
    f.firmId,
  ]);
  const otherVenue = await one(
    "insert into sites (firm_id, name, client_id) values ($1, 'Other Hall', $2)",
    [f.firmId, other],
  );
  const otherEvent = await one(
    "insert into shift_events (firm_id, name, site_id) values ($1, 'Other Gala', $2)",
    [f.firmId, otherVenue],
  );
  const session = await f.shift({ eventId: event, startsAt: fromNow(72), headcount: 4, role: "steward" });
  const otherSession = await f.shift({
    eventId: otherEvent,
    startsAt: fromNow(72),
    headcount: 2,
    role: "steward",
  });
  const ana = await f.worker({ first: "Anastasia", roles: ["steward"] });
  const ben = await f.worker({ first: "Benedikt", roles: ["steward"] });
  await f.booking(ana, session, "confirmed", 1);
  await f.booking(ben, session, "confirmed", 2);
  const contact = await one(
    `insert into client_contacts (firm_id, contract_id, name, email, created_by)
     values ($1, $2, 'Priya Shah', $3, $4)`,
    [f.firmId, contract, `priya.${randomUUID().slice(0, 8)}@example.com`, admin],
  );
  return { f, slug, admin, resourcer, payroll, contract, event, session, otherSession, contact };
}
type Scene = Awaited<ReturnType<typeof scene>>;

const tokenFor = async (t: Scene, kind: "client" | "office" | "worker", subjectId: string) =>
  (await withFirm(t.f.firmId, (tx) => createSession(tx, { kind, subjectId, now: new Date() })))
    .token;
const liveSession = (t: Scene, kind: "client" | "office" | "worker", token: string) =>
  withFirm(t.f.firmId, (tx) => findSession(tx, { kind, token, now: new Date() }));

// The request, as the browser sends it: the firm's host and these cookies.
const as = (t: Scene, cookies: Partial<Record<"client" | "office" | "worker", string>>) => {
  request.headers = new Headers({ host: `${t.slug}.${BASE}`, origin: `http://${t.slug}.${BASE}` });
  request.cookies = new Map(
    Object.entries(cookies).map(([k, v]) => [SESSION_COOKIES[k as "client"], v as string]),
  );
  request.deleted = [];
};
const asClient = async (t: Scene) => as(t, { client: await tokenFor(t, "client", t.contact) });
const asOffice = async (t: Scene, who: string) => as(t, { office: await tokenFor(t, "office", who) });

const logout = (t: Scene, kind: string) =>
  logoutPost(
    new Request(`http://${t.slug}.${BASE}/api/logout`, {
      method: "POST",
      headers: {
        host: `${t.slug}.${BASE}`,
        origin: `http://${t.slug}.${BASE}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ kind }),
    }),
  );

describe("logging out (the logout route, kind client)", () => {
  it("ends the client's session and clears their cookie; the office's and a casual's as before", async () => {
    const t = await scene();
    const client = await tokenFor(t, "client", t.contact);
    const office = await tokenFor(t, "office", t.resourcer);
    as(t, { client, office });
    const res = await logout(t, "client");
    expect(res.status).toBe(200);
    expect(await liveSession(t, "client", client)).toBeNull();
    expect(request.deleted).toEqual([SESSION_COOKIES.client]);
    // The office user's session, beside it, is untouched.
    expect(await liveSession(t, "office", office)).not.toBeNull();

    as(t, { office });
    expect((await logout(t, "office")).status).toBe(200);
    expect(await liveSession(t, "office", office)).toBeNull();
    expect(request.deleted).toEqual([SESSION_COOKIES.office]);

    const sam = await t.f.worker({ first: "Sam" });
    const worker = await tokenFor(t, "worker", sam);
    as(t, { worker });
    expect((await logout(t, "worker")).status).toBe(200);
    expect(await liveSession(t, "worker", worker)).toBeNull();
    expect(request.deleted).toEqual([SESSION_COOKIES.worker]);

    // Any other kind is refused.
    expect((await logout(t, "planner")).status).toBe(400);
  });
});

describe("the client's pages", () => {
  it("their events in numbers, never a casual's name; another contract's event is not found", async () => {
    const t = await scene();
    await asClient(t);
    const home = renderToStaticMarkup(await ClientEventsPage());
    expect(home).toContain("Demo Rovers v Visitors FC");
    expect(home).toContain("2 of 4 booked");
    expect(home).toContain("2 to fill");
    expect(home).not.toContain("Other Gala");
    const page = renderToStaticMarkup(
      await ClientEventPage({ params: Promise.resolve({ id: t.event }) }),
    );
    expect(page).toContain("2/4");
    for (const html of [home, page]) {
      expect(html).not.toMatch(/Anastasia|Benedikt/);
    }
    const { rows } = await su.query<{ id: string }>(
      "select event_id::text as id from shifts where id = $1",
      [t.otherSession],
    );
    await expect(
      ClientEventPage({ params: Promise.resolve({ id: rows[0]?.id ?? "" }) }),
    ).rejects.toThrow("not found");
  });

  it("send a request about their own session (never another contract's); answer a question", async () => {
    const t = await scene();
    await asClient(t);
    const ok = await sendClientRequestAction({
      kind: "more_places",
      shiftId: t.session,
      payload: { places: 2 },
      note: "Category B.",
    });
    expect(ok).toEqual({ status: "sent", urgent: false });
    expect(
      await sendClientRequestAction({
        kind: "more_places",
        shiftId: t.otherSession,
        payload: { places: 2 },
      }),
    ).toEqual({ status: "not_found" });
    expect(await sendClientRequestAction({ kind: "more_places", shiftId: t.session })).toEqual({
      status: "form",
    });
    const { rows } = await su.query<{ id: string }>(
      "select id::text as id from client_requests where firm_id = $1",
      [t.f.firmId],
    );
    const requestId = rows[0]?.id ?? "";
    // Not asked anything yet.
    expect(await replyToQuestionAction(requestId, "Yes")).toEqual({ status: "not_asked" });

    await asOffice(t, t.resourcer);
    expect(await askClientAction(requestId, "Which gate?")).toEqual({ status: "asked" });
    await asClient(t);
    expect(await replyToQuestionAction(requestId, "North Gate")).toEqual({ status: "sent" });

    // Logged out: nothing sent.
    as(t, {});
    expect(
      await sendClientRequestAction({ kind: "cancel_session", shiftId: t.session, payload: {} }),
    ).toEqual({ status: "logged_out" });
  });
});

describe("the office's answers (admins and resourcers)", () => {
  it("a resourcer accepts (the places offered) and declines; payroll may not; a planner's to-do is marked done", async () => {
    const t = await scene();
    await asClient(t);
    await sendClientRequestAction({ kind: "more_places", shiftId: t.session, payload: { places: 2 } });
    await sendClientRequestAction({ kind: "other", payload: { text: "Radios?" } });
    const ids = (
      await su.query<{ id: string; kind: string }>(
        "select id::text as id, kind from client_requests where firm_id = $1",
        [t.f.firmId],
      )
    ).rows;
    const more = ids.find((r) => r.kind === "more_places")?.id ?? "";
    const other = ids.find((r) => r.kind === "other")?.id ?? "";

    await asOffice(t, t.payroll);
    expect(await acceptClientRequestAction({ requestId: more })).toEqual({ status: "not_allowed" });
    expect(await declineClientRequestAction(other, "No")).toEqual({ status: "not_allowed" });

    await asOffice(t, t.resourcer);
    const accepted = await acceptClientRequestAction({ requestId: more });
    expect(accepted).toMatchObject({
      status: "accepted",
      applied: { kind: "more_places", from: 4, to: 6 },
    });
    const { rows: shift } = await su.query<{ headcount: number }>(
      "select headcount from shifts where id = $1",
      [t.session],
    );
    expect(shift[0]?.headcount).toBe(6);
    expect(await declineClientRequestAction(other, " ")).toEqual({ status: "invalid" });
    expect(await declineClientRequestAction(other, "We don't supply radios.")).toEqual({
      status: "declined",
    });
    expect(await markPlannerDoneAction(other)).toEqual({ status: "not_to_do" });

    // Logged out.
    as(t, {});
    expect(await acceptClientRequestAction({ requestId: more })).toEqual({ status: "logged_out" });
  });
});

describe("a contract's client logins (admins only)", () => {
  it("an admin adds one, sends a link and turns it off; a resourcer may not", async () => {
    const t = await scene();
    await asOffice(t, t.resourcer);
    expect(await addClientContactAction(t.contract, "Tom Reed", "tom@example.com")).toEqual({
      status: "not_allowed",
    });
    expect(await sendClientLinkAction(t.contact)).toEqual({ status: "not_allowed" });
    expect(await setClientContactOnAction(t.contact, false)).toEqual({ status: "not_allowed" });

    await asOffice(t, t.admin);
    const email = `tom.${randomUUID().slice(0, 8)}@example.com`;
    const added = await addClientContactAction(t.contract, "Tom Reed", email);
    expect(added).toMatchObject({ status: "added" });
    expect(await addClientContactAction(t.contract, "Tom Again", email)).toEqual({
      status: "email_taken",
    });
    expect(await addClientContactAction(t.contract, "", "x@example.com")).toEqual({
      status: "invalid",
      problem: "name",
    });
    const tom = added.status === "added" ? added.clientContactId : "";
    expect(await sendClientLinkAction(tom)).toEqual({ status: "sent" });
    expect(await setClientContactOnAction(tom, false)).toMatchObject({ status: "switched", on: false });
    expect(await sendClientLinkAction(tom)).toEqual({ status: "off" });
    expect(await setClientContactOnAction(tom, true)).toMatchObject({ status: "switched", on: true });
  });
});
