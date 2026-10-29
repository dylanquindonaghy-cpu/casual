import { z } from "zod";
import { REF_PATTERN } from "../integrations/schemas";
import { nameKey, readRoleName, readRoleNames, type NameMap } from "../roster/names";
import type { IncomingWorker } from "../roster/workers";

// The made-up portal (P5's framework; PLAN.md P5): a stand-in for the firm's real system, with our
// own field names (never the real portal's or AXLR8's), so the connector's whole path can be built
// and tested before the real API is known. Its records, read and checked here, then put in the
// planner API's own body (src/lib/integrations/schemas.ts) or a worker's (upsertWorker()): from
// there a connector's sessions go through exactly the planner's rules (putPlannerSession).
// Role names go through the firm's name map (P3.2): a mapped name is its code (and its pay rate
// when the record has none), a skipped one means the record isn't brought in, and a name neither
// the map nor normaliseRole() can read is refused. A staff type the map skips ("Permanent", say)
// isn't brought in either.

const ref = z.string().regex(REF_PATTERN);
const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const demoSessionRecord = z.object({
  ref,
  event: z
    .object({ ref, name: text(200) })
    .nullable()
    .optional(),
  site: z.object({ name: text(200), postcode: z.string().max(10).nullable().optional() }),
  role_name: text(200),
  starts_at: z.string().max(40),
  ends_at: z.string().max(40),
  places: z.number().int(),
  status: z.enum(["open", "cancelled"]),
  pay_rate_pence: z.number().int().nullable().optional(),
  post: optionalText(200),
  meeting_point: optionalText(500),
  uniform: optionalText(500),
  instructions: optionalText(2000),
  requirements: z.array(z.string().max(40)).max(20).optional(),
  change_reason: z.string().max(40).optional(),
});
export type DemoSessionRecord = z.infer<typeof demoSessionRecord>;

export const demoStaffRecord = z.object({
  ref,
  first_name: text(100),
  last_name: text(100),
  mobile: z.string().regex(/^\+[1-9]\d{6,14}$/),
  email: z.string().max(254).nullable().optional(),
  role_names: z.array(text(200)).max(20),
  staff_type: text(200).optional(),
  status: z.enum(["active", "inactive"]),
});
export type DemoStaffRecord = z.infer<typeof demoStaffRecord>;

export type Mapped<T> =
  | { status: "ok"; value: T }
  | { status: "skipped" } // the firm's map skips its role or staff type
  | { status: "unreadable"; code: "bad_record" | "bad_role" | "bad_staff_type" };

// A session record in the planner API's body (still checked again there, as any planner's is).
export function sessionBody(raw: unknown, names: NameMap): Mapped<Record<string, unknown>> {
  const parsed = demoSessionRecord.safeParse(raw);
  if (!parsed.success) return { status: "unreadable", code: "bad_record" };
  const r = parsed.data;
  if (r.status === "cancelled") {
    // A cancellation applies nothing else (the API's own rule); the source's reason, if it's one
    // of ours, else the planner API's refusal says one is needed.
    return {
      status: "ok",
      value: {
        status: "cancelled",
        ...(r.change_reason ? { change_reason: r.change_reason } : {}),
      },
    };
  }
  const role = readRoleName(r.role_name, names);
  if (role === null) return { status: "unreadable", code: "bad_role" };
  if ("skip" in role) return { status: "skipped" };
  const key = nameKey(r.role_name);
  const mappedRate = key === null ? null : (names.get("role")?.get(key)?.payRatePence ?? null);
  const body: Record<string, unknown> = {
    site: { name: r.site.name, ...(r.site.postcode ? { postcode: r.site.postcode } : {}) },
    role: role.role,
    starts_at: r.starts_at,
    ends_at: r.ends_at,
    places: r.places,
    status: "open",
  };
  if (r.event !== undefined) body.event = r.event;
  const pay = r.pay_rate_pence ?? mappedRate;
  if (pay !== null && pay !== undefined) body.pay_rate_pence = pay;
  for (const field of ["post", "meeting_point", "uniform", "instructions"] as const) {
    if (r[field] !== undefined) body[field] = r[field];
  }
  if (r.requirements !== undefined) body.requirements = r.requirements;
  if (r.change_reason !== undefined) body.change_reason = r.change_reason;
  return { status: "ok", value: body };
}

// A staff record as a worker (upsertWorker() decides what changes).
export function staffWorker(raw: unknown, names: NameMap): Mapped<IncomingWorker> {
  const parsed = demoStaffRecord.safeParse(raw);
  if (!parsed.success) return { status: "unreadable", code: "bad_record" };
  const r = parsed.data;
  if (r.staff_type !== undefined) {
    const key = nameKey(r.staff_type);
    if (key === null) return { status: "unreadable", code: "bad_staff_type" };
    const mapped = names.get("staff_type")?.get(key);
    // A staff type the map doesn't name is a casual's (the portal's own default).
    if (mapped && mapped.code === null) return { status: "skipped" };
  }
  const roles = readRoleNames(r.role_names, names);
  if (roles === null) return { status: "unreadable", code: "bad_role" };
  return {
    status: "ok",
    value: {
      ref: r.ref,
      firstName: r.first_name,
      lastName: r.last_name,
      mobileE164: r.mobile,
      roles,
      status: r.status,
      ...(r.email !== undefined ? { email: r.email } : {}),
    },
  };
}

// ---- The made-up portal itself: one in memory, for the tests and a local run ----

export interface DemoPortalSystem {
  apiKey: string;
  sessions: Map<string, unknown>;
  staff: Map<string, unknown>;
  down: boolean; // answers nothing (a fetch fails), as a real system would when it's down
  reads: number; // how many records were asked for
  lists: number; // how many lists were asked for (the reconcile pull)
}

// Base address -> that firm's system. Shared by the process (the tests fill it).
const systems = new Map<string, DemoPortalSystem>();

export const demoPortal = {
  system(baseUrl: string, apiKey: string): DemoPortalSystem {
    const made: DemoPortalSystem = {
      apiKey,
      sessions: new Map(),
      staff: new Map(),
      down: false,
      reads: 0,
      lists: 0,
    };
    systems.set(baseUrl, made);
    return made;
  },
  get(baseUrl: string): DemoPortalSystem | undefined {
    return systems.get(baseUrl);
  },
};
