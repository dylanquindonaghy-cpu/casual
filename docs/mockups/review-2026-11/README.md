# The office review of 2 Nov 2026, and the mock-ups for proposal P9

Dylan asked (2026-11-02) for a review of the live demo (acme.staffingresourcingtest.uk, made-up
people only), notes on what to improve, remove and reword, an audit against his Haulix reference,
and these changes: reliability data per casual; each resourcer choosing their contracts, cards and
charts; updates when cancellations come in or something needs doing; a "Who worked?" that makes
sense; a follow-up button for casuals who need updating; cancellations under 48 hours highlighted
and strikes shown clearly; who has applied for a session showing to casuals, filterable; offers by
app notification, email or Webex text, not WhatsApp.

`review.html` is the page (published as an artifact; its link is in `PLAN.md` under P9): the
review's findings, the eight changes as before-and-after mock-ups at 1280px and 390px in light and
dark, the remove-and-reword list, the reference audit and five decisions for Dylan. Nothing on it
is built. Open it in a browser from this folder (it loads `now/` beside it).

| File | What it shows |
|---|---|
| `review.html` | The review and the mock-ups (the office's round 7 tokens, from `src/app/globals.css`) |
| `now/*-laptop.jpg` | The live demo as the admin at 1280px, Mon 2 Nov 2026: dashboard, Needs attention, cancellations, Casuals (Need updating), Events & sessions, the offer page, a shift page, Pay dashboard, notice report, strikes |
| `now/*-phone.jpg` | The same at 390px: dashboard, cancellations, Casuals (Need updating); the casual app as Zoe Adeyemi (07700 900400): Open shifts and Profile's "How we reach you" |

## What the review found (the facts behind the page)

- **The runbook's demo number** (`07700 900101`) logs in to one of the five casuals the seed keeps
  free of shifts ("the five kept free, 0 to 4", `src/lib/db/admin/seed-data.ts`), so the casual
  app is empty.
  Fixed in `docs/runbooks.md` on this branch: `07700 900400`, Zoe Adeyemi.
- **Demo history at 04:00:** `recordEvent()` (`src/lib/events/record.ts`) can't set `created_at`
  (`defaultNow()`, `src/lib/db/schema/helpers.ts`), so every seeded log row carries the nightly
  reset's time; the notice report shows bookings "made" after the shifts they're for.
- **WhatsApp on screen:** the offer list (`src/lib/office/offer-words.ts`), the casual's Profile
  (WhatsApp is the `notify_channel` default, `src/lib/db/schema/people.ts`), the Pay dashboard's
  shifts line (`src/lib/tenancy/shifts-line.ts`), "Send OFFICE to reach a person" in automatic
  replies shown in the app (`docs/messaging-templates.md`). The sending code already goes push,
  then text, then email (`deliverToWorker`, `src/lib/notify/send.ts`).
- **Two pay days** on the Pay dashboard: the title's period pay day and "Next pay date" from the
  earliest imported `pay_records.pay_date` (`src/lib/office/pay-dashboard.ts`).
- **The cancellations card** "Under 48 hours' notice this week" shows the strikes count.
- **Who worked?** (`src/app/office/needs-items.tsx`): a group of same-time sessions shows
  "Session 1 … N" buttons, each opening that shift's page, where marking happens
  (`attendance-forms.tsx`: Worked / Didn't attend; "everyone else" once the session has ended).
- **Reliability:** the facts are stored (`assignments.status` completed / no_show /
  cancelled_worker / cancelled_firm with `notice_hours`; `strikes`), nothing sums them per casual;
  offer ranking (`rankForFairRotation`, `src/lib/rules/allocation.ts`) uses hours this week, last
  offered, a seeded shuffle, never reliability. Lateness isn't recorded anywhere.
- **No contracts, no preferences:** sites and events have no client or owner; `office_users` has
  no settings; the rail and theme are cookies per browser.
- **No office alert on a cancellation:** only an email for a place still free at start minus
  `escalate_hours_before_start` (3 h). Web push is for casuals only and is off on the demo
  (`PUSH_TRANSPORT=none`).
- **The Haulix shot couldn't be opened** (Dribbble refuses automated visits). The audit checks the
  goals recorded from it in rounds 4 and 5 (`docs/archive/plan-done.md`, Phase 24) and asks Dylan
  for screenshots for a side-by-side.
