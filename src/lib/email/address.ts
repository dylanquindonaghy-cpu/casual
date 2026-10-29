import { z } from "zod";
import { EMAIL_ADDRESS } from "../db/schema/tenancy";

// An email address as the staffing inbox keeps it (P7): trimmed and lower case (as a worker's is:
// src/lib/roster/workers.ts), an address zod accepts and the database's format holds
// (firms_inbox_address_format, inbound_emails_from_format); anything else is null. A display name
// ("Ann Example <ann@example.com>") is read for its address.
const shape = z.email().max(254).regex(new RegExp(EMAIL_ADDRESS));

export function emailAddress(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const angled = /<([^<>]*)>\s*$/.exec(raw);
  const address = (angled ? angled[1] : raw)?.trim().toLowerCase() ?? "";
  return shape.safeParse(address).success ? address : null;
}
