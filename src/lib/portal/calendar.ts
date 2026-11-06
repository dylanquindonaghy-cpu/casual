import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { systemClock } from "../auth/clock";
import { assignments, firms, shifts, sites } from "../db/schema";
import { withFirm } from "../db/scoped";
import { localDateOf } from "../time/zoned";
import { ownDomainUrl, portalUrl, type FirmAddress } from "../tenancy/portal-url";
import { sinceBooked } from "./changed-since";
import { roleLabel, siteAddress } from "./format";
import type { MyShift, PortalContext } from "./my-shifts";

// "Add to my calendar" (Phase 28.5; docs/screens.md "The casual app, Phase 28" 28.5;
// docs/api-and-jobs.md `GET /shifts/{id}/calendar`): one booked shift as an iCalendar file
// (RFC 5545) her phone opens in its calendar.
//
// What it holds, and only that: the role and the firm ("Steward · Acme Events"), the start and end
// in UTC, the site's name and address, and a link back to the shift's page. Never the pay, the
// instructions, the meeting point, the post or anyone else (docs/privacy-notice.md, 28.2's lines).
// Its UID is the booking's own, so adding it again replaces the entry; its SEQUENCE counts the
// office's moves of her booking since she booked, so a calendar holding the old times takes the new.
//
// calendarForWorker() reads inside the firm of her session (RLS): her own live booking only
// (confirmed, worked or not attended), on a session that isn't cancelled or a draft; anything else
// is null (the route answers "Not found." the same whether or not the shift exists). Reads only:
// a download changes nothing, so nothing is logged.

export interface CalendarShift {
  assignmentId: string;
  role: string;
  firmName: string;
  startsAt: Date;
  endsAt: Date;
  site: MyShift["site"];
  link: string; // the shift's page, absolute
  sequence: number;
  stamp: Date; // when the file was made (DTSTAMP)
}

const CRLF = "\r\n";

// 20261107T140000Z: UTC, to the second.
export const icsTime = (d: Date) =>
  d
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "");

// A TEXT value (RFC 5545 3.3.11): backslash, semicolon and comma escaped, a line break as \n.
export const icsText = (value: string) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");

// A content line folded at 75 octets (RFC 5545 3.1): each further line starts with one space, and a
// character is never split across lines.
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const out: string[] = [];
  let current = "";
  let octets = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // a continuation line's leading space counts
    if (octets + size > limit) {
      out.push(current);
      current = "";
      octets = 0;
    }
    current += ch;
    octets += size;
  }
  out.push(current);
  return out.join(`${CRLF} `);
}

// "shift-2026-11-07.ics", by the day it starts in the firm's time zone.
export const calendarFileName = (startsAt: Date, timeZone: string) =>
  `shift-${localDateOf(startsAt, timeZone)}.ics`;

export function shiftCalendar(s: CalendarShift): string {
  const where = s.site
    ? [s.site.name, siteAddress(s.site)].filter((p): p is string => !!p).join(", ")
    : null;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Casual shifts//Add to my calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:shift-booking-${s.assignmentId}`,
    `SEQUENCE:${s.sequence}`,
    `DTSTAMP:${icsTime(s.stamp)}`,
    `DTSTART:${icsTime(s.startsAt)}`,
    `DTEND:${icsTime(s.endsAt)}`,
    `SUMMARY:${icsText(`${roleLabel(s.role)} · ${s.firmName}`)}`,
    ...(where ? [`LOCATION:${icsText(where)}`] : []),
    `URL:${s.link}`,
    `DESCRIPTION:${icsText(`Your shift: ${s.link}`)}`,
    "STATUS:CONFIRMED",
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join(CRLF) + CRLF;
}

const uuid = z.uuid();

export interface CalendarFile {
  body: string;
  fileName: string;
}

export async function calendarForWorker(
  ctx: PortalContext & { baseDomain: string; address: FirmAddress },
  workerId: string,
  shiftId: string,
): Promise<CalendarFile | null> {
  if (!uuid.safeParse(shiftId).success || !uuid.safeParse(workerId).success) return null;
  const now = (ctx.clock ?? systemClock).now();
  const run = ctx.run ?? withFirm;
  return run(ctx.firm.id, async (tx) => {
    const [row] = await tx
      .select({
        assignmentId: assignments.id,
        confirmedAt: assignments.confirmedAt,
        role: shifts.role,
        startsAt: shifts.startsAt,
        endsAt: shifts.endsAt,
        siteName: sites.name,
        addressLine1: sites.addressLine1,
        addressLine2: sites.addressLine2,
        town: sites.town,
        postcode: sites.postcode,
      })
      .from(assignments)
      .innerJoin(
        shifts,
        and(eq(shifts.firmId, assignments.firmId), eq(shifts.id, assignments.shiftId)),
      )
      .leftJoin(sites, and(eq(sites.firmId, shifts.firmId), eq(sites.id, shifts.siteId)))
      .where(
        and(
          eq(assignments.shiftId, shiftId),
          eq(assignments.workerId, workerId),
          inArray(assignments.status, ["confirmed", "completed", "no_show"]),
          ne(shifts.status, "cancelled"),
          ne(shifts.status, "draft"),
        ),
      )
      .limit(1);
    if (!row) return null;
    const [firm] = await tx
      .select({
        name: firms.name,
        slug: firms.slug,
        timezone: firms.timezone,
        customDomain: firms.customDomain,
        domainVerified: firms.domainVerified,
      })
      .from(firms)
      .where(eq(firms.id, sql`app_current_firm_id()`));
    if (!firm) return null;
    // Back to the address she uses: the firm's own domain only when the request came in on it and
    // it's still the verified one (from the firm's record, never the request's Host), else its
    // portal (src/lib/tenancy/portal-url.ts).
    const base =
      ctx.address === "own_domain" && firm.domainVerified && firm.customDomain
        ? ownDomainUrl(firm.customDomain)
        : portalUrl(firm.slug, ctx.baseDomain);
    const { moves } = await sinceBooked(tx, {
      shiftId,
      assignmentId: row.assignmentId,
      confirmedAt: row.confirmedAt,
    });
    const body = shiftCalendar({
      assignmentId: row.assignmentId,
      role: row.role,
      firmName: firm.name,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      site: row.siteName
        ? {
            name: row.siteName,
            addressLine1: row.addressLine1,
            addressLine2: row.addressLine2,
            town: row.town,
            postcode: row.postcode,
          }
        : null,
      link: `${base}/shifts/${shiftId}`,
      sequence: moves,
      stamp: now,
    });
    return { body, fileName: calendarFileName(row.startsAt, firm.timezone) };
  });
}
