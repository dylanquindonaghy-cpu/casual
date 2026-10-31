import { NO_TEXTS_OUTBOX, NO_TEXTS_PORT } from "../../playwright.no-texts.config";
import { setFirmSetting } from "./db";
import { expect, test } from "./fixtures";
import { emailSentTo, readOutbox } from "./outbox";

// With no text sender (P2.7; docs/screens.md "How login links and codes go"; run by
// playwright.no-texts.config.ts): email login off, the login page says links can't be sent; on, a
// casual logs in and opens Pay by email, and no screen promises a WhatsApp. Zoe Adeyemi is the demo
// story's casual with an email address (src/lib/db/admin/seed-story.ts).

const acme = `http://acme.localhost:${NO_TEXTS_PORT}`;
const zoe = { typed: "07700 900400", mobile: "+447700900400", email: "zoe.adeyemi@example.com" };

test.describe.configure({ mode: "serial" });

test("email login off: no login form, and Help's words promise no WhatsApp", async ({ page }) => {
  await setFirmSetting("acme", "login_by_email", undefined);
  await page.goto(`${acme}/login`);
  await expect(page.getByText("Login links aren't switched on yet.")).toBeVisible();
  await expect(page.getByText("Please contact the office the way you usually do.")).toBeVisible();
  await expect(page.getByLabel("Your mobile number")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /me a link/ })).toHaveCount(0);

  await page.goto(`${acme}/help`);
  await expect(
    page.getByText("There's no app to download. Acme Events sends you a link."),
  ).toBeVisible();
  await expect(page.getByText(/WhatsApp/)).toHaveCount(0);
});

test("email login on: the link and the pay code come by email, and Profile shows the address", async ({
  page,
}) => {
  await setFirmSetting("acme", "login_by_email", true);
  const asked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/login`);
  await page.getByLabel("Your mobile number").fill(zoe.typed);
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByText("Check your email.")).toBeVisible();
  await expect(
    page.getByText("Not there in a few minutes? Look in your junk folder."),
  ).toBeVisible();
  const linkEmail = await emailSentTo(
    zoe.email,
    asked,
    /^Your Acme Events shifts link$/,
    NO_TEXTS_OUTBOX,
  );
  const link = /(https?:\/\/\S+\/l#[A-Za-z0-9_-]{43})/.exec(linkEmail.body)?.[1];
  if (!link) throw new Error("no login link in the email");
  await page.goto(link);
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page).toHaveURL(`${acme}/`);

  await page.goto(`${acme}/pay`);
  await expect(page.getByText("To see your pay, we'll email you a 6-digit code.")).toBeVisible();
  const codeAsked = new Date(Date.now() - 1000);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(
    page.getByText("We've emailed you a 6-digit code. It works for 10 minutes."),
  ).toBeVisible();
  const codeEmail = await emailSentTo(
    zoe.email,
    codeAsked,
    /^Your Acme Events code$/,
    NO_TEXTS_OUTBOX,
  );
  const code = /code is (\d{6})\./.exec(codeEmail.body)?.[1];
  if (!code) throw new Error("no code in the email");
  await page.getByLabel("Your code").fill(code);
  await page.getByRole("button", { name: "Check code" }).click();
  await expect(page.getByLabel("Your code")).toHaveCount(0);
  await expect(page.getByText(/from Acme Events' payroll|No pay data yet/).first()).toBeVisible();

  await page.goto(`${acme}/profile`);
  await expect(
    page.getByText(
      "Shift messages come as notifications on this phone, if you turn them on below. If not, we email",
    ),
  ).toBeVisible();
  await expect(page.getByText(zoe.email, { exact: true }).last()).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(page.getByText(/WhatsApp/)).toHaveCount(0);

  // Nothing went by WhatsApp or text: there's no text sender to carry one.
  const texts = (await readOutbox<{ channel?: string }>(NO_TEXTS_OUTBOX)).filter(
    (l) => l.channel === "whatsapp" || l.channel === "sms",
  );
  expect(texts).toEqual([]);
});
