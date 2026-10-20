import { createHash } from "node:crypto";

// A stable UUID (version 4 layout) derived from a name: the made-up demo's rows get the same ids
// on every run and every machine (src/lib/db/admin/seed-data.ts), so re-running the seed updates
// rows instead of duplicating them, and demo mode knows the demo firms by id (./firms.ts).
export function seedId(name: string): string {
  const h = createHash("sha256").update(`shiftdesk-seed:${name}`).digest("hex");
  const variant = ((parseInt(h[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
