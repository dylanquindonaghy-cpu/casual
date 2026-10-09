import { z } from "zod";

// Which tab and which columns of a firm's Google Sheet hold what. Columns are found by their
// header text in row 1 (case and surrounding spaces ignored), so a firm can reorder columns
// freely. Stored as roster_sources.mapping and always parsed with this schema.
//
// The sheet layout this expects (docs/architecture.md, Roster plugs):
// - a staff tab, one row per person, with a stable staff id column the firm keeps;
// - a shifts tab, one row per shift, with a stable shift id column and an "assigned" column
//   listing the staff ids holding its places, separated by commas, in slot order.

const header = z.string().trim().min(1).max(100);
const tab = z.string().trim().min(1).max(100);

export const sheetMappingSchema = z.object({
  version: z.literal(1),
  staff: z.object({
    tab,
    columns: z.object({
      ref: header,
      firstName: header,
      lastName: header,
      mobile: header,
      roles: header,
      status: header.optional(),
    }),
  }),
  shifts: z.object({
    tab,
    columns: z.object({
      ref: header,
      date: header,
      start: header,
      end: header,
      site: header.optional(),
      role: header,
      headcount: header.optional(),
      status: header.optional(),
      instructions: header.optional(),
      assigned: header,
    }),
  }),
});
export type SheetMapping = z.infer<typeof sheetMappingSchema>;

// The template a firm is given at onboarding.
export const DEFAULT_SHEET_MAPPING: SheetMapping = {
  version: 1,
  staff: {
    tab: "Staff",
    columns: {
      ref: "Staff ID",
      firstName: "First name",
      lastName: "Last name",
      mobile: "Mobile",
      roles: "Roles",
      status: "Status",
    },
  },
  shifts: {
    tab: "Shifts",
    columns: {
      ref: "Shift ID",
      date: "Date",
      start: "Start",
      end: "End",
      site: "Site",
      role: "Role",
      headcount: "Needed",
      status: "Status",
      instructions: "Instructions",
      assigned: "Assigned",
    },
  },
};
