import { Client } from "pg";
import { emailAddress } from "../src/lib/email/address";

// Setting a firm's staffing inbox (P7.1: firms.inbox_address, its address at our email provider,
// which its own staffing mailbox forwards to), for `npm run firm:inbox` (scripts/firm-inbox.ts),
// as the owner: the app role can't change firms. As scripts/shifts-line-owner.ts: RLS is forced for
// the owner too, so the change runs with the firm set for its transaction only; one address belongs
// to one firm (a unique column); every change is logged in the firm's action log in the same
// transaction, as a settings change (firm.settings_changed {keys: ["inbox_address"], change}),
// never the address itself.

export type SetInboxResult =
  | { status: "set"; address: string; before: string | null }
  | { status: "cleared"; before: string | null }
  | { status: "unchanged" }
  | { status: "no_firm" }
  | { status: "taken" } // another firm has that address
  | { status: "has_other"; before: string } // a different one is set: pass `replace` to change it
  | { status: "bad_address" };

export async function setInbox(
  adminUrl: string,
  slug: string,
  raw: string | null,
  opts: { replace?: boolean } = {},
): Promise<SetInboxResult> {
  const address = raw === null ? null : emailAddress(raw);
  if (raw !== null && address === null) return { status: "bad_address" };
  const owner = new Client({ connectionString: adminUrl });
  await owner.connect();
  try {
    const { rows } = await owner.query<{ id: string; inbox: string | null }>(
      "select id::text as id, inbox_address as inbox from firms where slug = $1",
      [slug.trim().toLowerCase()],
    );
    const firm = rows[0];
    if (!firm) return { status: "no_firm" };
    if (firm.inbox === address) return { status: "unchanged" };
    if (address !== null && firm.inbox !== null && !opts.replace) {
      return { status: "has_other", before: firm.inbox };
    }
    await owner.query("begin");
    try {
      await owner.query("select set_config('app.current_firm_id', $1, true)", [firm.id]);
      const updated = await owner.query("update firms set inbox_address = $2 where id = $1", [
        firm.id,
        address,
      ]);
      if (updated.rowCount !== 1) throw new Error("the firm's row wasn't updated");
      const change = address === null ? "cleared" : firm.inbox === null ? "set" : "replaced";
      await owner.query(
        `insert into events (firm_id, actor_type, action, entity_type, entity_id, data)
         values ($1, 'system', 'firm.settings_changed', 'firm', $1, $2)`,
        [firm.id, JSON.stringify({ keys: ["inbox_address"], change })],
      );
      await owner.query("commit");
    } catch (err) {
      // The first error is the one that matters, even if the rollback fails too.
      await owner.query("rollback").catch(() => undefined);
      if ((err as { code?: string }).code === "23505") return { status: "taken" };
      throw err;
    }
    return address === null
      ? { status: "cleared", before: firm.inbox }
      : { status: "set", address, before: firm.inbox };
  } finally {
    await owner.end();
  }
}
