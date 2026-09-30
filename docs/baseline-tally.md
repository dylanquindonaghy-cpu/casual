# Baseline week tally sheet

For the pilot firm's resourcer to fill in during the baseline week (week 0, before go-live:
`docs/pilot-playbook.md`), one normal week and, if possible, one busy week. Print it or copy it into
a spreadsheet. At the end of the week, work out the 8 figures below and enter them on the office's
Pilot figures page (`/office/reports/pilot`, "Baseline (week 0)"), so the pilot's weeks are compared
with it automatically. Counts only: no names or numbers on the sheet.

## Each day

| Day | Staff emails: shift queries | Cancellations | Pay | Other | Calls from staff | WhatsApp messages from staff | Shift queries with no reply after 24 hours | No-shows | Minutes on staff admin |
|---|---|---|---|---|---|---|---|---|---|
| Mon | | | | | | | | | |
| Tue | | | | | | | | | |
| Wed | | | | | | | | | |
| Thu | | | | | | | | | |
| Fri | | | | | | | | | |
| Sat | | | | | | | | | |
| Sun | | | | | | | | | |

- **WhatsApp messages:** group chats and direct messages, from staff.
- **Shift queries with no reply after 24 hours:** count them the day after (an email, call or message
  asking about a shift that nobody had answered 24 hours later).
- **Minutes on staff admin:** answering staff, chasing cover, updating the rota for changes. A rough
  estimate is fine; for two days, keep a proper time log.

## Each cancellation

| Day | Time the cancellation came in | Time a replacement was confirmed | Minutes between | Hours' notice before the shift started | By the worker or the firm? |
|---|---|---|---|---|---|
| | | | | | |

## The 8 figures for the Pilot figures page

1. **Staff emails per day:** all the email columns added up for the week, divided by 7.
2. **Calls per day:** the week's calls divided by 7.
3. **WhatsApp messages per day:** the week's messages divided by 7.
4. **Shift queries unanswered after 24 hours (%):** the week's "no reply after 24 hours" divided by
   the week's shift queries (emails, calls and messages about shifts), times 100.
5. **Time to refill a cancellation (median, in minutes):** put the "minutes between" column in
   order and take the middle one (for an even number, halfway between the middle two).
6. **No-shows per week:** the week's no-shows.
7. **Resourcer hours on staff admin per week:** the week's minutes divided by 60.
8. **Short-notice cancellations per week (firm and worker):** cancellations with less notice than
   the firm's short-notice threshold (48 hours unless it chose another: `npm run firm:settings`).

Then `npm run -s firm:check -- --firm <slug>` shows "[x] Baseline numbers recorded".
