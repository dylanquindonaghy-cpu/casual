# Pilot playbook

The pilot exists to produce numbers a second firm will believe.

## Before go-live: baseline (week 0)

Collect for one normal week and, if possible, one busy week (the resourcer's day-by-day tally
sheet, and how to turn it into the figures: `docs/baseline-tally.md`):

| Metric | How | Notes |
|---|---|---|
| Staff emails per day | Count inbox, by day | Split: shift queries / cancellations / pay / other |
| Calls per day | Phone log or tally sheet | |
| WhatsApp messages per day | Tally | Group chats and direct |
| Unanswered shift queries | Count emails with no reply after 24 h | Example firm: ~40% |
| Time to refill a cancellation | From cancel to confirmed replacement (median) | |
| No-shows per week | Count | |
| Resourcer hours on staff admin per week | Self-estimate, then a 2-day time log | Normal vs busy |
| Short-notice cancellations (firm and worker) | Count under the firm's threshold | For the 2027 story |

Enter these in `/office/reports/pilot` ("Baseline (week 0)") so the comparison is automatic.
During the pilot, enter the emails, calls, WhatsApp messages and resourcer hours each week under
"This week's tally" (the app can't see the office inbox or phone); everything else is counted by
the app each night (and on "Update the figures now").

## Dry-run event day (before go-live, with the resourcer)

A rehearsal of a real event day on the firm's own setup, with a pretend event and three volunteers,
so the resourcer has done everything once before staff rely on it, and anything confusing is fixed
first. After "Connect Twilio" (the volunteers' phones must get real messages), after onboarding
steps 1 to 11 (`docs/runbooks.md` "Onboarding a pilot firm"), before the staff briefing goes out.
About two hours on a quiet weekday.

**Set up (you):**
- Three volunteers with their own phones and agreement: the resourcer, you, and one friendly
  worker, each a worker of the firm (`npm run import`, or already imported), with the licences the
  pretend roles need, except one missing licence for step 4.
- A site called "Dry run" and a pretend event: 4 shifts at it two weeks ahead, and 2 tomorrow
  (inside the urgent window), in the office (Shifts → New shift). Dry-run events are dated before
  go-live, so they never count in the pilot's weeks.
- `npm run -s firm:check -- --firm <slug>`: everything `[x]` or confirmed, except the dry run itself.

**The steps** (who does it; what "worked" looks like):

1. **Log in** (each volunteer): text "shifts" to the shifts line, or open the portal's login page and
   give the mobile. A link arrives by WhatsApp within a minute; it opens My shifts, in the firm's
   colours, signed "[Firm] Shift Team".
2. **Take a shift** (volunteer): Open shifts → a "Dry run" shift → Take. It says so at once; the
   office sees it on the shift's page and in the action log.
3. **First yes wins** (two volunteers): both tap Take on the same one-place shift at the same moment.
   One gets it; the other is told it's just been filled.
4. **A shift the rules refuse** (the volunteer missing a licence): the shift explains why, in plain
   words, with "Ask the office to review". The office sees the review request.
5. **Cancel and the urgent wave** (volunteer): cancel tomorrow's shift with a reason. The office
   dashboard shows the cancellation with the notice given; the shift reopens as urgent; the other
   volunteers get the urgent offer; the first to take it gets it.
6. **The office changes and cancels** (resourcer): move a booked shift's time (choosing a reason),
   and cancel another booking. Each volunteer affected gets a message saying exactly what changed.
7. **A request** (volunteer, then resourcer): ask for a time change on a booked shift; the resourcer
   answers it on Enquiries, "Requests from the app"; the volunteer is told the answer.
8. **Pay** (volunteer): open Pay (a code arrives by WhatsApp first), see hours, rates and pay dates
   (if the firm's pay file is imported), and raise a pay question; payroll sees it grouped, and the
   next digest lists it.
9. **The shifts line** (volunteer, then someone who isn't a worker): text "I can't make tomorrow":
   the reply points to cancelling or reaches the office as a request. From a number that isn't a
   worker's: the polite reply, and the office is emailed and sees it on Enquiries.
10. **Reminders** (wait, or next morning): the volunteer booked on tomorrow's shift gets the 24-hour
    reminder, then the 2-hour one.
11. **The evidence** (resourcer): the notice and cancellation report lists every offer, booking,
    move and cancellation with who started it and the notice given; the action log shows each step;
    the CSV download opens in Excel.
12. **Wrap up** (resourcer): cancel the remaining "Dry run" shifts as the firm ("Another reason"),
    and write down anything that was confusing, slow or wrong.

| Step | Worked? | What was confusing, slow or wrong |
|---|---|---|
| 1 Log in | | |
| 2 Take a shift | | |
| 3 First yes wins | | |
| 4 Refused shift | | |
| 5 Cancel and urgent wave | | |
| 6 Office changes | | |
| 7 Request | | |
| 8 Pay | | |
| 9 Shifts line | | |
| 10 Reminders | | |
| 11 Evidence | | |
| 12 Wrap up | | |

Anything wrong: tell Claude before go-live. Then `firm:check`'s "[?] Dry-run event day" is
confirmed, and the staff briefing can go out.

## Weekly rhythm (4 weeks)

- **Monday:** 15-minute call with the resourcer: what worked, what was confusing, what they still
  had to do by hand.
- **Daily:** check escalations, unknown-number messages, failed jobs, sync errors.
- **Friday:** send the firm a short update: numbers this week vs baseline, fixes shipped (the
  Friday review, its table and the update's wording: `docs/pilot-report.md`).

## Metrics (from `events` and `messages`)

| Metric | Definition | Target by week 4 |
|---|---|---|
| Portal adoption | Active workers who logged in ≥ 1 time / active workers | 50% (stretch 75%) |
| Instant answers | Portal actions + instant replies / (portal actions + instant replies + office requests) | 90%+ |
| Unanswered shift queries | Requests open > 24 h / all requests | < 2% |
| Urgent fill rate | Urgent shifts filled via waves / urgent shifts | 60%+ without a call |
| Median refill time | cancel → confirmed replacement | half of baseline |
| Inbound emails + calls | From the resourcer's tally | −50% |
| Resourcer hours | Self-report + time log | −15–20% normal, −30% busy |
| No-shows | Count | down vs baseline |

## Pilot report template (send at week 4)

Where each number comes from, step by step: `docs/pilot-report.md` "The week-4 report".

1. **Headline:** "X% of shift queries answered instantly, refill time from A to B, Y resourcer hours a week back."
2. Baseline vs pilot table (above).
3. What staff said (3 quotes, with permission).
4. Notice and cancellation report summary (ready for 2027).
5. What we'd change next.
6. Offer: continue at ~£3 per active worker per month (£199 minimum), monthly rolling.

## Converting and referring

- Ask on the week-4 call, with the report in front of them.
- Ask for one introduction to a peer firm and permission to use them as a reference.
- If they say no: ask what would have made it a yes, and write it in `docs/business.md` under Risks.

## Founder capacity

You work 07:45–late afternoon. Set expectations: pilot support by WhatsApp; the resourcer has
the manager fallback for calls; you check in at lunch and after work. Don't promise real-time
support during your working hours.
