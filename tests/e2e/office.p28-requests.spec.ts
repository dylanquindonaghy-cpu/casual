import type { Page, TestInfo } from "@playwright/test";
import { addOfficeUser } from "./db";
import { expect, test } from "./fixtures";
import { sentTo } from "./outbox";
import { markOf, officeRequestsScene, P28_9_OFFICE_CASUAL, takeBack } from "./p28/28-9-data";

// Phase 28.9 on the office's side (docs/screens.md "### 28.9", `/office/enquiries` "Requests from
// the app"), in a real browser: a casual's attendance question ("Says the mark is wrong", the mark
// now, "Mark again" to the session's who-worked, and one action that answers it, with no decline);
// answering stores it as answered and never changes the mark; a request the casual takes back
// leaves "Waiting for an answer" and shows as "Taken back" in the history. The casual, his requests
// and the resourcer are this spec's own (tests/e2e/p28/28-9-data.ts), so the demo's requests stay
// waiting for the other specs.

const acme = "http://acme.localhost:3100";

async function officeLogin(page: Page, email: string) {
  const asked = new Date(Date.now() - 1000);
  await page.goto(`${acme}/office/login`);
  await page.getByLabel("Your work email").fill(email);
  await page.getByRole("button", { name: "Send me a link" }).click();
  await expect(page.getByText("Check your email.")).toBeVisible();
  const link = await sentTo(email, asked, /(https?:\/\/\S+\/office\/l#[A-Za-z0-9_-]{43})/);
  await page.goto(link);
  await page.getByRole("button", { name: "Log me in" }).click();
  await expect(page).toHaveURL(`${acme}/office`);
}

async function shoot(page: Page, testInfo: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  const body = await page.screenshot({ fullPage: true, animations: "disabled" });
  await testInfo.attach(name, { body, contentType: "image/png" });
}

test("an attendance question with Mark again and one answer; a taken-back request leaves the waiting list", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const email = "p28-requests.resourcer@example.com";
  await addOfficeUser("acme", { email, name: "Requests Twentyeight", role: "resourcer" });
  const scene = await officeRequestsScene();
  const first = P28_9_OFFICE_CASUAL.firstName;
  const name = `${P28_9_OFFICE_CASUAL.firstName} ${P28_9_OFFICE_CASUAL.lastName}`;
  await officeLogin(page, email);

  await page.goto(`${acme}/office/enquiries?view=app`);
  const waiting = page.getByRole("region", { name: "Waiting for an answer" });
  const question = waiting.locator(`#request-${scene.attendanceId}`);
  await expect(question.getByText("Attendance question", { exact: true })).toBeVisible();
  await expect(question.getByText(name, { exact: true })).toBeVisible();
  await expect(
    question.getByText("Says the mark is wrong: marked not attended (they say they worked)."),
  ).toBeVisible();
  await expect(question.getByText("Their note: I signed in at the north gate.")).toBeVisible();
  await expect(question.getByText("Marked now: Didn't attend.")).toBeVisible();
  await expect(
    question.getByText("Answering doesn't change the mark. If it's wrong, mark again first."),
  ).toBeVisible();
  const markAgain = question.getByRole("link", { name: "Mark again" });
  await expect(markAgain).toHaveAttribute(
    "href",
    `/office/shifts/${scene.sessionId}?show=booked#places`,
  );
  await expect(question.getByRole("button", { name: `Answer and tell ${first}` })).toBeVisible();
  await expect(question.getByRole("button", { name: /^Decline/ })).toHaveCount(0);
  await expect(question.getByLabel(`Note to ${first} (optional)`)).toBeVisible();

  // The swap he asked for is waiting too, until he takes it back.
  await expect(waiting.locator(`#request-${scene.swapId}`)).toBeVisible();
  await shoot(page, testInfo, "28.9 office requests, waiting");
  expect(await takeBack(scene.workerId, scene.swapId)).toBe("withdrawn");
  await page.reload();
  await expect(waiting.locator(`#request-${scene.swapId}`)).toHaveCount(0);
  const history = page.getByRole("region", { name: "Answered in the last 7 days" });
  const takenBack = history.locator("li", { hasText: `Reference ${scene.swapRef}` });
  await expect(takenBack.getByText("Taken back", { exact: true })).toBeVisible();
  await expect(takenBack).toContainText(`Taken back by ${first} at `);
  await expect(takenBack.getByText(/was told|will be told|Telling/)).toHaveCount(0);

  // "Mark again" opens the session's Booked tab, where who worked is marked.
  await markAgain.click();
  await expect(page).toHaveURL(
    new RegExp(`/office/shifts/${scene.sessionId}\\?show=booked#places$`),
  );
  await page.goBack();

  // One action: answered, with an optional note; the mark stays as it was.
  const card = page
    .getByRole("region", { name: "Waiting for an answer" })
    .locator(`#request-${scene.attendanceId}`);
  await card.getByLabel(`Note to ${first} (optional)`).fill("We've checked the gate log.");
  await card.getByRole("button", { name: `Answer and tell ${first}` }).click();
  await expect(card.getByText(`Answered. ${first} will be told.`)).toBeVisible();
  expect(await markOf(scene.assignmentId)).toBe("no_show");
  await page.reload();
  const answered = page
    .getByRole("region", { name: "Answered in the last 7 days" })
    .locator("li", { hasText: `Reference ${scene.attendanceRef}` });
  await expect(answered.getByText(/^Answered$/)).toBeVisible();
  await expect(answered).toContainText("Answered by Requests Twentyeight at ");
  await expect(answered.getByText("Note: We've checked the gate log.")).toBeVisible();
  await expect(answered.getByText("Marked now: Didn't attend.")).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Waiting for an answer" })
      .locator(`#request-${scene.attendanceId}`),
  ).toHaveCount(0);
  await shoot(page, testInfo, "28.9 office requests, answered");
});
