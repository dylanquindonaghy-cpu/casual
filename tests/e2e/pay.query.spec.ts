import { dayLabel } from "../../src/lib/rules/reasons";
import { addOfficeUser, setFirmSetting } from "./db";
import { expect, menuLink, test } from "./fixtures";
import { codeSentTo, emailSentTo, loginLinkSentTo, sentTo } from "./outbox";

// Raising a pay query in a real browser: behind the pay code, a day, what's wrong and a note, the
// confirmation, then the query listed on the pay page "With payroll". A different seeded worker
// from the pay spec, so the two don't share the per-number login and code limits. Then payroll
// sees it in its group and sends the digest: the email, with the list attached, reaches the outbox.
// Last, payroll sorts it with a note: the worker gets the message and sees "Sorted" on the pay page.

const acme = "http://acme.localhost:3100";
const mobile = "+447700900103"; // a seeded Acme worker

test("raise a pay query about a day, then see it on the pay page", async ({ page }) => {
  // No scheduled digest for Acme in this run, so only "Send the digest now" (below) can send the
  // query: the e2e worker's tick would otherwise send one at the firm's digest time.
  await setFirmSetting("acme", "pay_digest", { days: [] });
  const asked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/login`);
  await page.getByLabel("Your mobile number").fill("07700 900103");
  await page.getByRole("button", { name: "Send me a link" }).click();
  await page.goto(await loginLinkSentTo(mobile, asked));
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page).toHaveURL(`${acme}/`);

  // Without the pay code, the form points back to the pay page.
  await page.goto(`${acme}/pay/query`);
  await expect(
    page.getByText("To keep your pay private, enter your pay code first."),
  ).toBeVisible();

  await page.goto(`${acme}/pay`);
  const codeAsked = new Date(Date.now() - 1000);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(await codeSentTo(mobile, codeAsked));
  await page.getByRole("button", { name: "Check code" }).click();
  await expect(page.getByRole("heading", { name: "Your pay queries" })).toBeVisible();
  await expect(page.getByText("None in the last 90 days.")).toBeVisible();

  await page.getByRole("link", { name: "Raise a pay query" }).click();
  await expect(page).toHaveURL(`${acme}/pay/query`);
  await page.getByLabel("Which shift?").selectOption({ label: "A day not in the list" });
  const threeDaysAgo = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(
    new Date(Date.now() - 3 * 86_400_000),
  );
  await page.getByLabel("Which day?").fill(threeDaysAgo);
  // "Something else" needs a word or two.
  await page.getByLabel("Something else").check();
  await page.getByRole("button", { name: "Send pay query" }).click();
  await expect(page.getByText("Tell payroll what's wrong.", { exact: true })).toBeVisible();

  await page.getByLabel("Paid late or not paid").check();
  await page.getByLabel("Tell payroll more (optional)").fill("Not paid for this day yet (e2e).");
  await page.getByRole("button", { name: "Send pay query" }).click();
  await expect(page.getByText("Pay query sent.")).toBeVisible();
  await expect(page.getByText(/^Reference: [0-9A-F]{8}$/)).toBeVisible();
  await expect(page.getByText("Acme Events Shift Team")).toBeVisible();

  await page.getByRole("link", { name: "Back to your pay" }).click();
  await expect(page).toHaveURL(`${acme}/pay`);
  await expect(page.getByText(/^Paid late or not paid: \w{3} \d{1,2} \w{3}$/)).toBeVisible();
  await expect(page.getByText("With payroll")).toBeVisible();

  // Payroll (a user of this spec's own) sees it in its group, with the note.
  const email = "pay.payroll@example.com";
  await addOfficeUser("acme", { email, name: "Pay Payroll", role: "payroll" });
  const asked2 = new Date(Date.now() - 1000);
  await page.goto(`${acme}/office/login`);
  await page.getByLabel("Your work email").fill(email);
  await page.getByRole("button", { name: "Send me a link" }).click();
  await page.goto(await sentTo(email, asked2, /(https?:\/\/\S+\/office\/l#[A-Za-z0-9_-]{43})/));
  await page.getByRole("button", { name: "Log me in" }).click();
  await (await menuLink(page, "Pay queries")).click();
  await expect(page).toHaveURL(`${acme}/office/pay-queries`);
  const group = page.getByRole("region", {
    name: /^\d+ quer(y|ies): paid late or not paid, the week of \w{3} \d{1,2} \w{3}\.$/,
  });
  await expect(group.getByRole("heading")).toBeVisible();
  await expect(group.getByText("“Not paid for this day yet (e2e).”")).toBeVisible();

  // The digest: payroll sends it now, and it arrives with the list attached.
  const digest = page.getByRole("region", { name: "Payroll digest" });
  await expect(digest.getByText("No digest is scheduled. You can send one now.")).toBeVisible();
  const sentAfter = new Date(Date.now() - 1000);
  await digest.getByRole("button", { name: "Send the digest now" }).click();
  await expect(digest.getByRole("status")).toHaveText(
    /^Sending the digest now: \d+ new quer(y|ies) to \d+ (person|people)\. It should arrive in a minute or two\.$/,
  );
  const mail = await emailSentTo(email, sentAfter, /^Acme Events: \d+ new pay quer(y|ies)$/);
  expect(mail.body).toMatch(/^\d+ new pay quer(y|ies) since the last digest/);
  expect(mail.body).toContain(
    "Answer them on the pay queries page: http://acme.localhost:3100/office/pay-queries",
  );
  expect(mail.body).toContain("— Acme Events Shift Team");
  // What the worker wrote is only in the attached list.
  expect(mail.body).not.toContain("Not paid for this day yet (e2e).");
  const [list] = mail.attachments ?? [];
  expect(list?.filename).toMatch(/^pay-queries-\d{4}-\d{2}-\d{2}\.csv$/);
  expect(list?.content).toContain("Not paid for this day yet (e2e).");
  expect(list?.content).toContain("Paid late or not paid");

  // Back on the page: the last digest, and the query marked as in it.
  const mine = group.getByRole("listitem").filter({ hasText: "Not paid for this day yet (e2e)." });
  await expect(async () => {
    await page.reload();
    await expect(
      digest.getByText(
        /^Last digest: \d{2}:\d{2} on \w{3} \d{1,2} \w{3}, \d+ quer(y|ies) to \d+ (person|people)\.$/,
      ),
    ).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await expect(mine.getByText(/· In a digest$/)).toBeVisible();

  // Payroll sorts the group with a note; the worker is told (quiet hours off for Acme just while
  // it goes, so the time of day doesn't matter, then put back as it was).
  const quietBefore = await setFirmSetting("acme", "quiet_hours", {
    start: "00:00",
    end: "00:00",
    urgent_override: true,
  });
  try {
    const sortedAfter = new Date(Date.now() - 1000);
    await group
      .getByLabel("Tell them what payroll did")
      .fill("Paid on Friday with the rest (e2e).");
    await group.getByRole("button", { name: "Mark as sorted and tell them" }).click();
    await expect(group.getByRole("status")).toHaveText(
      /^Marked as sorted: \d+ quer(y|ies)\. Each person will get your note by message\.$/,
    );
    const update = await sentTo(
      mobile,
      sortedAfter,
      /(Update on your pay query \(ref [0-9A-F]{8}\): sorted\. Paid on Friday with the rest \(e2e\)\. — Acme Events Shift Team)/,
    );
    expect(update).toBeTruthy();
  } finally {
    await setFirmSetting("acme", "quiet_hours", quietBefore);
  }

  // The worker's pay page (the pay code is still good): sorted today, with payroll's note.
  await page.goto(`${acme}/pay`);
  const today = dayLabel(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date()),
  );
  await expect(page.getByText(`Sorted on ${today}`)).toBeVisible();
  await expect(page.getByText("Payroll says: “Paid on Friday with the rest (e2e).”")).toBeVisible();
});
