import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDirectory } from "@/lib/db/directory";
import { createWithFirm, type WithFirm } from "@/lib/db/scoped";
import { DEFAULT_BRAND_COLOUR, firmBrand } from "@/lib/tenancy/brand";
import { bookingFirm } from "../helpers/booking-fixture";
import { appRolePool, superuserPool, urls } from "../helpers/db";
import { setFirmBrand } from "../../scripts/firm-brand-owner";

// A firm's brand (Phase 8): read for the portal from the firm's own row (src/lib/tenancy/brand.ts)
// and set by the owner (`npm run firm:brand`, scripts/firm-brand-owner.ts). On the real database;
// the reading as the app role. Logo addresses use the reserved .example and .invalid names:
// nothing is ever fetched.

let su: Pool;
let app: Pool;
let withFirm: WithFirm;

beforeAll(() => {
  su = superuserPool();
  app = appRolePool(3);
  withFirm = createWithFirm(app);
});
afterAll(async () => {
  await Promise.all([su.end(), app.end()]);
});

async function firm() {
  const f = await bookingFirm(su, withFirm);
  const { rows } = await su.query<{ slug: string; name: string }>(
    "select slug, name from firms where id = $1",
    [f.firmId],
  );
  return { f, slug: rows[0]?.slug ?? "", name: rows[0]?.name ?? "" };
}

const brandOf = (firmId: string) => firmBrand({ firm: { id: firmId }, run: withFirm });
const eventsOf = async (firmId: string) =>
  (
    await su.query<{ actor_type: string; entity_id: string; data: Record<string, unknown> }>(
      `select actor_type, entity_id::text as entity_id, data from events
        where firm_id = $1 and action = 'firm.branding_changed' order by id`,
      [firmId],
    )
  ).rows;

describe("the brand on the portal", () => {
  it("a firm with nothing set: its name in the default colours, no logo", async () => {
    const t = await firm();
    expect(await brandOf(t.f.firmId)).toEqual({
      name: t.name,
      logoUrl: null,
      background: DEFAULT_BRAND_COLOUR,
      text: "#ffffff",
      own: false,
    });
  });

  it("each firm sees its own brand, never another's", async () => {
    const a = await firm();
    const b = await firm();
    await su.query(
      "update firms set brand_primary_color = '#FFFF00', brand_logo_url = $2 where id = $1",
      [a.f.firmId, "https://logo.example.invalid/a.png"],
    );
    await su.query("update firms set brand_primary_color = '#0f766e' where id = $1", [b.f.firmId]);
    expect(await brandOf(a.f.firmId)).toEqual({
      name: a.name,
      logoUrl: "https://logo.example.invalid/a.png",
      background: "#ffff00",
      text: "#000000",
      own: true,
    });
    expect(await brandOf(b.f.firmId)).toMatchObject({
      name: b.name,
      logoUrl: null,
      background: "#0f766e",
    });
    // Inside one firm's transaction, no other firm's row is there to read.
    const seen = await withFirm(a.f.firmId, (tx) => tx.execute("select id from firms"));
    expect(seen.rows).toEqual([{ id: a.f.firmId }]);
  });

  it("an https address with a user name and password in it is stored, but never shown", async () => {
    const t = await firm();
    await su.query("update firms set brand_logo_url = $2 where id = $1", [
      t.f.firmId,
      "https://me:secret@logo.example.invalid/x.png",
    ]);
    expect((await brandOf(t.f.firmId))?.logoUrl).toBeNull();
  });

  it("the database refuses a colour that isn't #rrggbb and a logo that isn't https://", async () => {
    const t = await firm();
    await expect(
      su.query("update firms set brand_primary_color = 'red' where id = $1", [t.f.firmId]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      su.query("update firms set brand_logo_url = 'http://x.example/l.png' where id = $1", [
        t.f.firmId,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
  });
});

describe("setting the brand (npm run firm:brand)", () => {
  it("sets the colour, logo, name and sign-off; logs which fields changed, never the values", async () => {
    const t = await firm();
    expect(
      await setFirmBrand(urls.admin, t.slug, {
        colour: "1D4ED8",
        logo: " https://logo.example.invalid/acme.png ",
      }),
    ).toEqual({ status: "saved", fields: ["colour", "logo"] });
    expect(await brandOf(t.f.firmId)).toMatchObject({
      logoUrl: "https://logo.example.invalid/acme.png",
      background: "#1d4ed8",
      text: "#ffffff",
    });
    const newName = `${t.name} Ltd`;
    expect(
      await setFirmBrand(urls.admin, t.slug, {
        name: `  ${newName}  `,
        signOff: "Acme  Shift Team",
      }),
    ).toEqual({ status: "saved", fields: ["name", "signOff"] });
    expect((await brandOf(t.f.firmId))?.name).toBe(newName);
    const logged = await eventsOf(t.f.firmId);
    expect(logged).toEqual([
      { actor_type: "system", entity_id: t.f.firmId, data: { fields: ["colour", "logo"] } },
      { actor_type: "system", entity_id: t.f.firmId, data: { fields: ["name", "signOff"] } },
    ]);
    expect(JSON.stringify(logged)).not.toMatch(/1d4ed8|logo\.example|Acme Shift Team|Ltd/i);
  });

  it("every message's sign-off follows it: the firm's own, then back to \"[Firm] Shift Team\"", async () => {
    const t = await firm();
    const directory = createDirectory(app);
    expect((await directory(t.slug))?.signOff).toBe(`${t.name} Shift Team`);
    await setFirmBrand(urls.admin, t.slug, { signOff: "Acme Shift Team" });
    expect((await directory(t.slug))?.signOff).toBe("Acme Shift Team");
    expect(await setFirmBrand(urls.admin, t.slug, { signOff: null })).toEqual({
      status: "saved",
      fields: ["signOff"],
    });
    expect((await directory(t.slug))?.signOff).toBe(`${t.name} Shift Team`);
  });

  it("refuses what it can't use, changing nothing", async () => {
    const t = await firm();
    for (const [changes, field] of [
      [{ colour: "blue" }, "colour"],
      [{ colour: "#12345" }, "colour"],
      [{ logo: "http://logo.example.invalid/a.png" }, "logo"],
      [{ logo: "javascript:alert(1)" }, "logo"],
      // Golden rule 8: "… Shift Team", never a person's name or another team's.
      [{ signOff: "Sarah" }, "signOff"],
      [{ signOff: "Acme Rota Desk" }, "signOff"],
      [{ signOff: "Shift Team" }, "signOff"],
      [{ signOff: "Acme <script> Shift Team" }, "signOff"],
      [{ signOff: `${"x".repeat(49)} Shift Team` }, "signOff"],
      // Empty is not "none": null is (an unset shell variable mustn't clear anything).
      [{ signOff: "" }, "signOff"],
      [{ signOff: "   " }, "signOff"],
      [{ logo: "" }, "logo"],
      [{ logo: "   " }, "logo"],
      [{ colour: "" }, "colour"],
      [{ name: "" }, "name"],
      [{ name: "A" }, "name"],
      [{ name: "Acme\nEvents" }, "name"],
    ] as const) {
      expect(await setFirmBrand(urls.admin, t.slug, changes), JSON.stringify(changes)).toEqual({
        status: "bad",
        field,
      });
    }
    expect(await brandOf(t.f.firmId)).toMatchObject({
      name: t.name,
      logoUrl: null,
      background: DEFAULT_BRAND_COLOUR,
    });
    expect(await eventsOf(t.f.firmId)).toEqual([]);
  });

  it("renaming a firm whose stored sign-off is the old name's default: messages then carry the new name", async () => {
    const t = await firm();
    const directory = createDirectory(app);
    await su.query(
      "update firms set settings = jsonb_set(settings, '{sign_off}', to_jsonb($2::text)) where id = $1",
      [t.f.firmId, `${t.name} Shift Team`],
    );
    expect(await setFirmBrand(urls.admin, t.slug, { name: `${t.name} Two` })).toEqual({
      status: "saved",
      fields: ["name", "signOff"],
    });
    expect((await directory(t.slug))?.signOff).toBe(`${t.name} Two Shift Team`);
    // A firm's own shortened sign-off stays through a rename.
    await setFirmBrand(urls.admin, t.slug, { signOff: "Acme Shift Team" });
    expect(await setFirmBrand(urls.admin, t.slug, { name: `${t.name} Three` })).toEqual({
      status: "saved",
      fields: ["name"],
    });
    expect((await directory(t.slug))?.signOff).toBe("Acme Shift Team");
  });

  it("the same again changes nothing; clearing the logo; a firm that doesn't exist", async () => {
    const t = await firm();
    await setFirmBrand(urls.admin, t.slug, {
      colour: "#0f766e",
      logo: "https://logo.example.invalid/n.png",
    });
    expect(
      await setFirmBrand(urls.admin, t.slug, {
        colour: "#0F766E",
        logo: "https://logo.example.invalid/n.png",
      }),
    ).toEqual({ status: "unchanged" });
    expect(await setFirmBrand(urls.admin, t.slug, { logo: null })).toEqual({
      status: "saved",
      fields: ["logo"],
    });
    expect((await brandOf(t.f.firmId))?.logoUrl).toBeNull();
    expect(await setFirmBrand(urls.admin, "no-such-firm-zz", { colour: "#000000" })).toEqual({
      status: "no_firm",
    });
  });
});
