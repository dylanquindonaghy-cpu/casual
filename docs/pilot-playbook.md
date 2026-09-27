# Pilot playbook

The pilot exists to produce numbers a second firm will believe.

## Before go-live: baseline (week 0)

Collect for one normal week and, if possible, one busy week:

| Metric | How | Notes |
|---|---|---|
| Staff emails per day | Count inbox, by day | Split: shift queries / cancellations / pay / other |
| Calls per day | Phone log or tally sheet | |
| WhatsApp messages per day | Tally | Group chats and direct |
| Unanswered shift queries | Count emails with no reply after 24 h | Founder's firm: ~40% |
| Time to refill a cancellation | From cancel to confirmed replacement (median) | |
| No-shows per week | Count | |
| Resourcer hours on staff admin per week | Self-estimate, then a 2-day time log | Normal vs busy |
| Short-notice cancellations (firm and worker) | Count under the firm's threshold | For the 2027 story |

Enter these in `/office/reports/pilot` so the comparison is automatic.

## Weekly rhythm (4 weeks)

- **Monday:** 15-minute call with the resourcer: what worked, what was confusing, what they still
  had to do by hand.
- **Daily:** check escalations, unknown-number messages, failed jobs, sync errors.
- **Friday:** send the firm a short update: numbers this week vs baseline, fixes shipped.

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
