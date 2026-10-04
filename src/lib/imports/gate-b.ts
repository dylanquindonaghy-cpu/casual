import { eq, sql } from "drizzle-orm";
import { firms } from "../db/schema";
import type { FirmTx } from "../db/scoped";

// Gate B (PLAN.md "Gates"; golden rule 7): no real staff data before a firm's agreement and DPA
// are signed. On a live database (anything not on this machine) an import saves rows only for a
// firm whose signing is recorded (`firms.agreement_signed_on`, set by the owner with `npm run
// firm:agreement`). The same for the office's web imports and `npm run import` (audit L39); the
// owner's `npm run firm:sheet` checks it too. A check (a dry run) saves nothing, so it isn't asked.

export class AgreementNotRecorded extends Error {
  constructor() {
    super("the firm's agreement and DPA aren't recorded as signed");
    this.name = "AgreementNotRecorded";
  }
}

// Inside the firm's transaction. Throws AgreementNotRecorded when saving to a live database
// for a firm with no recorded signing.
export async function requireAgreementForImport(
  tx: FirmTx,
  opts: { saving: boolean; localDatabase: boolean },
): Promise<void> {
  if (!opts.saving || opts.localDatabase) return;
  const [firm] = await tx
    .select({ signedOn: firms.agreementSignedOn })
    .from(firms)
    .where(eq(firms.id, sql`app_current_firm_id()`));
  if (!firm?.signedOn) throw new AgreementNotRecorded();
}
