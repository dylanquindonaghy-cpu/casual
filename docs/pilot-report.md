# Pilot review and week-4 report

For the four pilot weeks (`docs/pilot-playbook.md`). Every figure comes from the office's Pilot
metrics page (`/office/reports/pilot`, admins and resourcers), which shows the week-0 baseline next
to the app's own figures for the dates you choose, with each figure's target. Names on this page
are the page's own; nothing here needs a database or a spreadsheet.

## Every Friday (20 minutes)

1. The resourcer enters the week's tally first (Pilot metrics, "This week's tally": emails, calls,
   WhatsApp messages, hours on staff admin: the app can't see the office inbox or phone).
2. Open Pilot metrics, choose From Monday To Sunday of the pilot week, press Show. If the figures
   look stale, press "Update the figures now".
3. Copy the figures into the table below.
4. Look at what needs a person: the office dashboard's Needs attention, Enquiries' "Need a person"
   (messages from numbers we don't know too) and "Requests from the app", the action log filtered to Messages for anything that failed, and the server's alerts
   (docs/runbooks.md "Alerts from the app").
5. Send the firm the Friday update (below).

| Figure (as the page names it) | Baseline | Week 1 | Week 2 | Week 3 | Week 4 | Target |
|---|---|---|---|---|---|---|
| Messages in per day (emails, calls and WhatsApp) | | | | | | Half the baseline |
| Shift queries unanswered after 24 hours | | | | | | Under 2% |
| Portal actions (staff doing it themselves) | | | | | | |
| Answered straight away | | | | | | 90% or more |
| Time to refill a cancellation (median) | | | | | | Half the baseline |
| Active workers (booked on a shift in these dates) | | | | | | |
| Portal adoption (active workers who have logged in) | | | | | | 50% (stretch 75%) |
| Urgent shifts filled from offers | | | | | | 60% or more without a call |
| No-shows per week | | | | | | Fewer than the baseline |
| Short-notice cancellations per week (firm and worker) | | | | | | |
| Resourcer hours on staff admin per week | | | | | | 15 to 20% fewer (30% in busy weeks) |

## The Friday update (a short email to the firm)

> Week [n] of your ShiftDesk pilot. [Answered straight away]% of staff questions were answered
> straight away (target 90%), and [unanswered]% waited more than a day (was [baseline]%).
> Cancellations were refilled in a median of [time] (was [baseline]). [Adoption]% of active
> workers have logged in. This week we fixed: [fixes]. Next week: [one thing].

## The week-4 report

Choose From the pilot's first Monday To its fourth Sunday on Pilot metrics (the page shows up to
92 days at once), and the same dates on the notice and cancellation report
(`/office/reports/notice`).

1. **Headline:** "[Answered straight away]% of shift questions answered straight away, refill time
   from [baseline] to [week 4], [baseline hours − pilot hours] resourcer hours a week back."
   (Hours back: the baseline's "Resourcer hours on staff admin per week" minus the pilot's.)
2. **Baseline against the pilot:** the table above, the four weeks' figures and the whole pilot's.
3. **What staff said:** three short quotes, each with the person's permission to be quoted (ask
   them; don't take them from the shifts line's messages).
4. **The notice and cancellation report:** for the four weeks, how many offers, bookings, moves and
   cancellations, who started each, and how many were at short notice; attach its CSV download.
   This is the evidence the firm will need under the 2027 rules.
5. **What we'd change next:** from the Monday calls and the Friday checks.
6. **The offer:** continue at about £3 per active worker per month (£199 minimum), monthly rolling.

**Gate C** (PLAN.md): unanswered shift queries near 0%, resourcer time measurably saved, and at
least 50% of active workers using the portal. If all three are met, convert and ask for a referral
(`docs/pilot-playbook.md` "Converting and referring").
