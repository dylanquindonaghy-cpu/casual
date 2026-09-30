import { sql } from "drizzle-orm";
import { firms } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { effectiveSettings } from "./settings";

// The pilot onboarding checklist (docs/go-to-market.md; docs/runbooks.md "Onboarding a pilot
// firm"), item by item, from the firm's own data where it can be seen, and "confirm yourself" where
// it can't (the paperwork, the privacy notice, the staff briefing, the dry run). Read-only, inside
// the firm's transaction (RLS). Counts, role names and settings only: never a worker's or office
// user's name, number or email (`npm run firm:check` prints it in a terminal).

export type ReadinessState = "done" | "todo" | "confirm";

export interface ReadinessItem {
  item: string;
  state: ReadinessState;
  detail: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export async function firmReadiness(tx: FirmTx): Promise<ReadinessItem[]> {
  const [firm] = await tx
    .select({
      name: firms.name,
      colour: firms.brandPrimaryColor,
      logo: firms.brandLogoUrl,
      settings: firms.settings,
      line: firms.shiftsLineE164,
      domain: firms.customDomain,
      domainVerified: firms.domainVerified,
    })
    .from(firms);
  if (!firm) throw new Error("the firm isn't visible inside its own transaction");

  const { rows: countRows } = await tx.execute<{
    admins: number;
    resourcers: number;
    payroll: number;
    workers: number;
    workers_without_credentials: number;
    credentials: number;
    rules: number;
    baseline: number;
  }>(sql`
    select
      (select count(*)::int from office_users where status = 'active' and role = 'admin') as admins,
      (select count(*)::int from office_users where status = 'active' and role = 'resourcer') as resourcers,
      (select count(*)::int from office_users where status = 'active' and role = 'payroll') as payroll,
      (select count(*)::int from workers where status = 'active') as workers,
      (select count(*)::int from workers w where w.status = 'active'
          and not exists (select 1 from credentials c where c.worker_id = w.id)) as workers_without_credentials,
      (select count(*)::int from credentials) as credentials,
      (select count(*)::int from credential_rules) as rules,
      (select count(*)::int from metrics_daily where kind = 'baseline') as baseline
  `);
  const c = countRows[0];
  if (!c) throw new Error("the counts came back empty");

  // Roles in use (on active workers, or on shifts not cancelled that haven't ended) that have no
  // credential rule: the rules refuse those shifts to everyone (eligibility's "no_rule").
  const { rows: unruled } = await tx.execute<{ role: string }>(sql`
    select distinct r.role from (
      select unnest(roles) as role from workers where status = 'active'
      union select role from shifts where status <> 'cancelled' and ends_at > now()
    ) r
    where not exists (select 1 from credential_rules cr where cr.role = r.role)
    order by r.role
  `);
  const { rows: sheet } = await tx.execute<{
    last_synced_at: Date | null;
    last_error_code: string | null;
  }>(sql`
    select last_synced_at, last_error_code from roster_sources where enabled limit 1
  `);

  const settings = effectiveSettings(firm.settings)
    .map((s) => `${s.key} ${String(s.value)}${s.source === "default" ? " (default)" : ""}`)
    .join("; ");
  const signOff =
    typeof firm.settings.sign_off === "string"
      ? firm.settings.sign_off
      : `${firm.name} Shift Team (default)`;
  const source = sheet[0];

  const items: ReadinessItem[] = [
    {
      item: "Agreement + DPA signed",
      state: "confirm",
      detail: "Not recorded here: confirm both are signed before importing any real data (Gate B).",
    },
    {
      item: "Firm branding and sign-off",
      state: firm.colour ? "done" : "todo",
      detail: `Colour ${firm.colour ?? "not set"}, logo ${firm.logo ? "set" : "not set"}, signed "${signOff}".${firm.colour ? "" : " Set them: npm run firm:brand."}${firm.domain ? ` Own domain ${firm.domain} (${firm.domainVerified ? "verified" : "not verified yet"}).` : ""}`,
    },
    {
      item: "Office users",
      state: c.admins > 0 ? "done" : "todo",
      detail: `${plural(c.admins, "admin", "admins")}, ${plural(c.resourcers, "resourcer", "resourcers")}, ${plural(c.payroll, "payroll user", "payroll users")} (active).${c.admins > 0 ? "" : " There must be an admin."}`,
    },
    source
      ? {
          item: "Rota source",
          state: source.last_synced_at && !source.last_error_code ? "done" : "todo",
          detail: source.last_synced_at
            ? `Google Sheet, last synced ${source.last_synced_at.toISOString()}${source.last_error_code ? `, now failing (${source.last_error_code})` : ""}.`
            : `Google Sheet added, never synced${source.last_error_code ? ` (${source.last_error_code})` : ""}.`,
        }
      : {
          item: "Rota source",
          state: "confirm",
          detail:
            "No Google Sheet: shifts are made in the office or imported from CSV. Confirm that's what the firm wants.",
        },
    {
      item: "Workers and credentials imported",
      state: c.workers > 0 && c.credentials > 0 ? "done" : "todo",
      detail: `${plural(c.workers, "active worker", "active workers")}, ${plural(c.credentials, "credential", "credentials")}; ${plural(c.workers_without_credentials, "active worker has", "active workers have")} no credential on file. Import: npm run import (only after Gate B).`,
    },
    {
      item: "Credential rules for every role",
      state: c.rules > 0 && unruled.length === 0 ? "done" : "todo",
      detail:
        unruled.length === 0
          ? `${plural(c.rules, "rule", "rules")}; every role in use has one.`
          : `No rule for: ${unruled.map((r) => r.role).join(", ")}. Shifts for a role with no rule are refused to everyone.`,
    },
    {
      item: "Settings agreed",
      state: "confirm",
      detail: `As the app reads them now: ${settings}. Change with npm run firm:settings.`,
    },
    {
      item: "Shifts line (Twilio number) and WhatsApp display name",
      state: firm.line ? "confirm" : "todo",
      detail: firm.line
        ? `Number ${firm.line} set. Confirm WhatsApp approved the display name.`
        : "No number yet: after Connect Twilio, npm run firm:line.",
    },
    {
      item: "Privacy notice line added by the firm",
      state: "confirm",
      detail: "Not recorded here: docs/compliance.md has the suggested words.",
    },
    {
      item: "Staff briefing message sent with the portal link",
      state: "confirm",
      detail: "Not recorded here: the firm sends it.",
    },
    {
      item: "Dry-run event day with the resourcer",
      state: "confirm",
      detail: "Not recorded here: docs/pilot-playbook.md.",
    },
    {
      item: "Baseline numbers recorded",
      state: c.baseline > 0 ? "done" : "todo",
      detail:
        c.baseline > 0
          ? `${plural(c.baseline, "baseline figure", "baseline figures")} saved.`
          : "None yet: the office's Pilot figures page, Baseline week.",
    },
  ];
  return items;
}

const MARK: Record<ReadinessState, string> = { done: "[x]", todo: "[ ]", confirm: "[?]" };

export function readinessText(firmName: string, items: ReadinessItem[]): string {
  const lines = items.map((i) => `${MARK[i.state]} ${i.item}: ${i.detail}`);
  const todo = items.filter((i) => i.state === "todo").length;
  const confirm = items.filter((i) => i.state === "confirm").length;
  return [
    `Onboarding ${firmName}: ${plural(todo, "thing", "things")} to do, ${confirm} to confirm yourself.`,
    ...lines,
    "[x] done  [ ] to do  [?] confirm yourself (not recorded in the app)",
  ].join("\n");
}
