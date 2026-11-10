import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { answers } from "../db/schema";
import type { FirmTx } from "../db/scoped";
import { recordEvent, type EventInput } from "../events/record";

// The five starter answers (Phase 35; docs/messaging-templates.md "The answer library"), added for
// every firm switched off, until someone has read them: migration 0073 for the firms there then
// (the same words, with Office hours' second example as 0074 left it: tests/unit/
// answers.library.test.ts), firm creation
// (scripts/firm-create-owner.ts) and the demo seed (on there, but Parking). Each is filled only from
// the fixed fill-ins. UK English, short and plain.

export interface Starter {
  key: string;
  name: string;
  examples: readonly string[];
  body: string;
}

export const STARTERS: readonly Starter[] = [
  {
    key: "pay_day",
    name: "Pay day",
    examples: [
      "when do we get paid",
      "when will i get paid",
      "is pay this friday",
      "when is payday",
    ],
    body: "Your next pay day is {next_pay_day}, for shifts {pay_cycle}. Your hours and rates: {pay_link}",
  },
  {
    key: "what_to_wear",
    name: "What to wear",
    examples: ["what do i wear", "what uniform", "do i need my hi vis"],
    body: "For {next_shift}: {next_shift_instructions}",
  },
  {
    key: "renewing_licence",
    name: "Renewing a licence",
    examples: ["my licence runs out", "my badge runs out", "new licence"],
    body: "Your {licence_expiry}. When you have the new one, add it on Profile: {profile_link}. The office checks it.",
  },
  {
    key: "parking",
    name: "Parking",
    examples: ["where do i park", "is there parking"],
    body: "Each shift says where to park in its instructions. If it doesn't, staff parking isn't provided: please use public transport or a nearby car park.",
  },
  {
    key: "office_hours",
    name: "Office hours",
    examples: ["is anyone in", "what time do you open"],
    body: "The office is open Monday to Friday, 9:00 to 17:00. Out of hours, questions about your shifts, cancelling and pay are answered here straight away.",
  },
];

export type StarterKey = (typeof STARTERS)[number]["key"];

// Adds the starters this firm doesn't have yet (at most one of each: a partial unique index), in the
// caller's transaction, each logged `answer.created` by the system (and `answer.switched` for one
// added switched on). `switchedOn`: the starters to add switched on (the demo seed's); none
// otherwise. Ones the firm already has are left exactly as they are. Returns the ids added. `log`:
// the demo seed's own log (src/lib/db/admin/seed-log.ts), as applyCredentialPack takes it.
export async function addStarterAnswers(
  tx: FirmTx,
  opts: { switchedOn?: readonly string[] } = {},
  log: (tx: FirmTx, event: EventInput) => Promise<unknown> = recordEvent,
): Promise<string[]> {
  const have = await tx
    .select({ key: answers.starterKey })
    .from(answers)
    .where(
      and(
        isNotNull(answers.starterKey),
        inArray(
          answers.starterKey,
          STARTERS.map((s) => s.key),
        ),
      ),
    );
  const had = new Set(have.map((r) => r.key));
  const added: string[] = [];
  for (const s of STARTERS) {
    if (had.has(s.key)) continue;
    const isOn = opts.switchedOn?.includes(s.key) ?? false;
    const [row] = await tx
      .insert(answers)
      .values({
        firmId: sql`app_current_firm_id()`,
        name: s.name,
        examples: s.examples.join("\n"),
        body: s.body,
        isOn,
        starterKey: s.key,
      })
      .onConflictDoNothing()
      .returning({ id: answers.id });
    if (!row) continue;
    added.push(row.id);
    await log(tx, {
      actorType: "system",
      action: "answer.created",
      entityType: "answer",
      entityId: row.id,
      data: { answerId: row.id, starter: s.key },
    });
    if (isOn) {
      await log(tx, {
        actorType: "system",
        action: "answer.switched",
        entityType: "answer",
        entityId: row.id,
        data: { answerId: row.id, on: true },
      });
    }
  }
  return added;
}

// The demo's starters, switched on (but Parking: a demo firm's sessions say where to park).
export const DEMO_STARTERS_ON = STARTERS.map((s) => s.key).filter((k) => k !== "parking");

// Only for tests' convenience: a firm's starter by key.
export async function starterId(tx: FirmTx, key: string): Promise<string | null> {
  const [row] = await tx
    .select({ id: answers.id })
    .from(answers)
    .where(eq(answers.starterKey, key));
  return row?.id ?? null;
}
