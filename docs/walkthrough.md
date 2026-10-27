# Walk through ShiftDesk on your own computer

This is a guided tour of every screen, on your own computer, with the demo's made-up firms and
people. Nothing leaves your computer: no real WhatsApp, text or email is sent. Every message the
app would send is printed in a terminal window instead, and you copy links from there.

It takes about two hours the first time. You can stop after any part and come back: start again at
step 8 (`npm run dev`), or at step 7 to put the demo back as it was.

A browser test (`tests/e2e/walkthrough.spec.ts`) does every step below, in this order, each time
the app is checked. If a step doesn't do what it says here, that's a bug: use the template at the
end.

**Words used here:**
- **Ubuntu** is the Linux window on your Windows computer (WSL). You type the commands there.
- **The dev window** is the Ubuntu window running `npm run dev` (step 8). Messages appear there.
- **Command:** type it (or paste it with a right-click) into Ubuntu, then press Enter.

## Part 1: set up (once)

1. **Docker Desktop.** It runs the database. If it isn't installed: download Docker Desktop for
   Windows from docker.com and install it, keeping "Use WSL 2" ticked. Open it, then go to
   Settings → Resources → WSL integration, turn on "Ubuntu", and click "Apply & restart". Each
   time you walk through, open Docker Desktop first and wait until it says "Engine running"
   (bottom left).
2. **Open Ubuntu** from the Start menu. You see a line ending in `$`.
3. **Go to the project folder:**

   ```
   cd ~/shiftdesk-starter
   ```

   You should see `~/shiftdesk-starter$` at the start of the line.
4. **The settings file.** If you've never made one, copy the example (`ls -a` lists `.env` if you
   have one already):

   ```
   cp -n .env.example .env
   ```

   Then give the shifts line a made-up key, so the fake phone (Part 4) is accepted. It's only for
   your computer:

   ```
   grep -q '^TWILIO_AUTH_TOKEN=' .env && sed -i 's/^TWILIO_AUTH_TOKEN=.*/TWILIO_AUTH_TOKEN=local-fake-token-not-real-0000/' .env || echo 'TWILIO_AUTH_TOKEN=local-fake-token-not-real-0000' >> .env
   ```

   Check it with `grep TWILIO_AUTH_TOKEN .env`: one line,
   `TWILIO_AUTH_TOKEN=local-fake-token-not-real-0000`.
5. **Install the project's parts** (the first time, and after each update you pull):

   ```
   npm install
   ```

   It ends with "added … packages" or "up to date". Warnings are fine.
6. **Start the database:**

   ```
   npm run db:up
   ```

   You should see the container "Healthy". If it says it can't connect to the Docker daemon,
   Docker Desktop isn't running (step 1).
7. **Make the demo** (this wipes your local database and builds the demo again: run it whenever
   you want a fresh start):

   ```
   npm run db:reset
   ```

   It ends with a summary: `acme: 60 workers, … 40 shifts on Saturday …`, `northline: 30 workers,
   …`, and `Urgent dropout (a door supervisor shift): http://acme.localhost:3000/shifts/…`. Keep
   that link: step 18 uses it.
8. **Start the app:**

   ```
   npm run dev
   ```

   Wait for "Ready" and "[worker] started". Leave this window open: it's the dev window. To stop
   the app later, click in it and press Ctrl+C.
9. **The browser:** use **Chrome or Edge**. Others may not keep you logged in on these local
   addresses. Open a second Ubuntu window (right-click Ubuntu on the taskbar, then "Ubuntu") for
   the commands in Part 4: run `cd ~/shiftdesk-starter` in it first.

**Finding a link in the dev window.** Each message the app would send is printed between a line
starting `[messaging:console] whatsapp to …` (or `email to …`) and a line
`[messaging:console] end of message`. Use the newest one. Select the address starting `http://`
with the mouse; in Ubuntu, selecting copies it. Paste it into Chrome's address bar. Login links
work for 15 minutes, once.

## Part 2: as a worker

A worker's pages have a tab bar at the bottom: Home, Shifts, Pay and Profile. "Log out" is the
last thing on Profile (`http://acme.localhost:3000/profile`), with "Help", which explains the
worker's pages in plain words; for the office, "Log out" is under your name at the top right. The
office menu is on the left on a laptop; on a phone, open it with "Menu" at the top. The worker's side is made for phones. In Chrome you can see it as a phone: press
F12, then Ctrl+Shift+M (press them again to go back). Each worker below is a made-up person from
the demo.

10. **Log in as Zoe Usman** (a steward who isn't booked on anything). Go to
    `http://acme.localhost:3000/login`. Type `07700 900122` in "Your mobile number" and click
    "Send me a link". The page says "Check your phone." In the dev window, a WhatsApp to
    `+44*******122` says "Here's your Acme Events shifts link…": open that link, then click
    "Log me in". You see "Hello Zoe" and "No shifts booked yet."
11. **Take a shift.** On Home, click "See all open shifts". The coming Saturday's open steward shifts are
    listed, each with its pay, post, chips for what it needs and how far it is. On the one at "Acme
    Demo Arena", click "Take shift". It says "You're booked." with a
    reference and "— Acme Events Shift Team".
12. **Cancel it.** Click "See my shifts" (Home). Under "Your next shift", click "Cancel this shift",
    choose "I'm unwell", then "Confirm cancellation". It says "Cancelled. Reference …" and whether a
    strike was recorded (a box above the reasons said which before you confirmed), with the notice
    you gave. Click "Back to my shifts": "No shifts booked yet." again.
13. **Your pay.** Click "Pay" in the tab bar, then "Send me a code". A 6-digit code arrives in the dev
    window ("Your Acme Events code is …"). Type it in "Your code" and click "Check code". You see
    "The last 8 weeks, from Acme Events's payroll." with the hours and rates.
14. **Raise a pay query.** On the pay page, click "Raise a pay query". In "Which shift?" choose "A
    day not in the list", pick any day last week in "Which day?", choose "Paid late or not paid",
    type a note if you like, and click "Send pay query". It says "Pay query sent." with a
    reference.
15. **Your profile.** Click "Profile" in the tab bar. Zoe's "Level 2 spectator safety
    qualification" shows as Valid. Mark a day you can't work, then "Remove" it. Then click "Log
    out", the last thing on the page.
16. **Log in as Sam Walsh** (`07700 900110`), a steward booked on Saturday. Home's "Your next
    shift" shows it in full, with the day's "Instructions" under it. Click "Shifts" in the tab bar
    (his bookings), then "Past 30 days": yesterday's race day at "Acme Demo Racecourse" is listed.
    Click "Upcoming" to go back.
17. **Ask for a change.** On Home, click "Ask for a change", choose "Change the times", set
    "New start" to 13:00 and "New finish" to 18:30, and click "Send request". It says "Request
    sent." Click "See my requests": it's "Waiting for the office". Log out.
18. **Log in as Maya Morgan** (`07700 900129`), a door supervisor whose SIA licence has expired.
    A red "Needs updating" card on Home says so. Open the urgent shift's page: the link
    printed at the end of `npm run db:reset` (step 7; it isn't in her open shifts, because she
    can't take it). "What it needs" shows her licence as "Expired on …: upload it", and it says
    "You can't take this shift:" and why. Click "Ask the office to review": it gives a
    reference. Log out.
19. **Log in as Wes Doyle** (`07700 900139`), a door supervisor with a valid licence. Home's
    "Urgent: needed now, and you can take them" lists the 08:00 arena shift (and, from Friday noon,
    Zoe's cancelled shift too: it's then less than a day away, so it's urgent). Click "See urgent
    shifts", then "Take shift" on the 08:00
    arena shift: "You're booked." Log out.
20. **Log in as Zoe Adeyemi** (`07700 900400`), one of the mock-up's casuals (a door supervisor,
    steward and CSAS officer who starts from ZZ1 4DE). Home's urgent shifts each say how far they
    are, and how long by car and by public transport (for example "7.2 miles · 18 min by car · 41
    min by public transport"). Click "Profile" in the tab bar: her staff photo is "Due soon", and
    each qualification has its status. Under "Where you work", click "Change your travel area":
    choose "60 minutes" and click "Save travel area". It says "Saved. This is your travel area
    now." Click "Back to my profile", then log out.
21. **Log in as Kieran Doyle** (`07700 900401`), a door supervisor whose SIA licence ran out 5 days
    ago. Click "Profile": "Strikes" says "You have 2 strikes in the last 90 days.", with each one
    and where it stands. On Home, the "Needs updating" card's "Upload your SIA door supervisor
    licence" opens the page where he'd send a photo of his new card (don't send one). Log out.

## Part 3: as the office

The office is made for a laptop or desktop: if you switched Chrome to a phone view, press F12
again to go back. Every office page has the same bar along the top (the counts "To fill",
"Urgent", "Offers out" and "To check", each opening where it's worked; "Search"; a light or dark
button; and your initials and name) and the same menu down the left as icons, with the page you're
on marked and a red dot where a page needs you; the button under the firm's mark shows their
names. (In a narrow window the menu hides behind "Menu" at the top left, and "Close menu" puts it
away.) Your initials open your name and role, "Switch to dark mode" (or light), "How-to guide",
which explains each job step by step, and "Log out".

22. **Log in as the resourcer.** Go to `http://acme.localhost:3000/office/login`, type
    `acme.resourcer@example.com` in "Your work email", and click "Send me a link". In the dev
    window an email ("Your Acme Events office login link") has the link: open it, then click "Log
    me in". You see the "Dashboard", with today, the pay week and its pay day under it.
23. **The dashboard.** On the right, "All", "Urgent", "This week" and "Next week", each with how
    many sessions have places to fill. Under them "Places to fill": a bar for each day of this week
    and next, black for places with no offers out and blue for places offered with no reply yet
    (point at a bar for its figures). Beside it the session you picked (the soonest urgent one at
    first): when and where, how soon it starts, the offers sent and who hasn't replied, "Offer to
    someone", "Open the shift", and "…" with "Mark as filled" and "Not urgent". Under them four
    columns: "To offer", "Offered", "While you were out" (places casuals took from offers between
    18:00 and 08:00) and "Who worked?" (yesterday's racecourse bookings, not marked yet). Click a
    card to see it beside the chart; "Show … more" shows the rest of a column. The bar's "To check"
    counts what Needs attention holds. Click "Cancellations" in the menu: every cancellation, Zoe's
    among them, and "nothing here needs approving".
24. **Offer a gap.** Back on the "Dashboard", click the paper plane on a card under "To offer". A
    panel lists who can take it: click "Send offer to …" on the first person. It says "Offered",
    the foot of the panel says "Offer on its way to …", and the offer appears in the dev window.
    Press Escape. (Events & sessions has every session too: "Need people", then a session's "…"
    on its event's card, then "Offer a place".)
25. **Enquiries, and answer a request.** Click "Enquiries": the shifts line's messages, newest
    first, each with how it was answered (on a computer the first one shows beside the list:
    click another to see it there; on a phone a message opens on its own page). Kieran Doyle's "I need to cancel please", Ben Fraser's
    pay question ("Pay (always a person)") and Zoe Adeyemi's "Hi, any shifts for me?" came in just
    before the demo was made. Click "Requests from the app". On Sam Walsh's time
    change, click "Approve and tell Sam". It says "Approved. Sam will be told." The message to Sam
    appears in the dev window.
26. **Mark who worked.** Click "Needs attention" in the menu. Under "Who worked?", open one of
    yesterday's racecourse shifts. Click "Mark as worked" for the person on it:
    "Marked … as worked." (On a shift with several people, "Mark as not attended" and "Mark the …
    not marked yet as worked" are there too.)
27. **Make a shift and book someone.** Click "Events & sessions", then "All shifts by day", then
    "New shift". Pick a date next week,
    Role "steward", Start 10:00, Finish 18:00, Places 2, and click "Create shift". On the new
    shift's page, under "Assign someone", choose a person in "Who?" and click "Check" (if it says
    they can't work it, and why, choose someone else), then "Assign …". It says "… is booked on this shift. They'll get a message to say so.", and the "Confirmed:
    …" message appears in the dev window.
28. **Move it, then cancel the booking.** Under "Move, shorten or cancel", set "New start" to 11:00
    and "New finish" to 19:00, choose the reason "The event's times or place changed", and click
    "Move for everyone booked". It says "Moved. 1 person booked will be told." Then click "Cancel
    …'s booking", choose "Weather or safety", and click "Yes, cancel …'s booking": "Cancelled
    …'s booking with … notice. They'll be told."
29. **A whole event, and an import.** Click "Events & sessions", then "Add shifts": give the event a
    name (for example "Cup final"), pick a date and fill in two lines (for example a steward 08:00 to 16:00 and a door supervisor 20:00 to 04:00),
    then click "Create these shifts". It says "2 shifts created." Then make the sample files in
    your second Ubuntu window:

    ```
    npm run -s walkthrough:files
    ```

    On "Events & sessions", click "Import shifts", choose `shifts.csv` (see "Opening the sample files"
    below), click "Check the file", then "Import these shifts".
30. **Cancellations.** Click "Cancellations": every cancellation, newest first, each with the
    notice given and whether it was a strike. They're recorded automatically, never approved or
    declined. Open Zoe Usman's (step 12): the record as it was, with "Download PDF" for the
    evidence.
31. **Strikes.** Click "Strikes": the casuals with strikes that still count, most first. Kieran
    Doyle has 2. Click "Needs review": Priya Shah's strike is there, because she cancelled for a
    reason a person should look at. Click her latest strike to open its record, then click "Keep
    strike": "Kept, and marked as reviewed." (Or "Withdraw strike…", with a reason: it then stops
    counting.)
32. **Casuals.** Click "Casuals" (everyone, with their qualifications, travel areas and strikes;
    "Need updating" lists who has something to sort out). In the search box beside the views
    ("Name or mobile number"), type `Zoe` and click "Find". Open Zoe Usman from the matches under it: what needs updating, her
    qualifications, travel area, strikes, bookings and access. (Don't make her inactive: later
    steps use her.) Then click "Uploads to check": Ben Fraser's new staff photo and Leah Ward's
    new licence wait for a person. Click "Check it" on Ben's, look at the picture, and click
    "Approve staff photo".
33. **The action log.** Click "Action log". Everything you've done is there, newest first. Choose
    Type "Cancellations" and click "Show".
34. **The notice report.** Click "Notice report". The cancellations are listed with the notice each
    worker had, short notice flagged (under 48 hours). Click "Download as a spreadsheet (CSV)" to
    see the file.
35. **Pilot metrics.** Click "Pilot metrics". Under "Baseline (week 0)", fill in "Staff emails per
    day" (say 40) and click "Save the baseline": "Baseline saved." Then click your name at the top
    right, and "Log out".
36. **Log in as payroll** (`acme.payroll@example.com`, as in step 22). You land on the "Pay
    dashboard": what's waiting for payroll, the next digest and the next pay date. Click "Pay
    queries". The
    queries are grouped by likely cause, biggest first: 7 stewards about one week's rate, 2 about
    hours missing at the shopping centre, 1 "something else", and Zoe's "paid late" from step 14.
    Click "Send the digest now": it says how many new queries it's sending, and an email with the
    list attached appears in the dev window. (On a weekday after 09:00, the day's digest goes by
    itself soon after `npm run dev` starts: then "Send the digest now" sends only the ones since.)
37. **Answer a group.** On the stewards' rate group, type a note in "Tell them what payroll did"
    (for example "We've added the difference to Friday's pay.") and click "Mark as sorted and tell
    them". Each of them is told (the dev window).
38. **Import pay records.** Click "Import pay records", choose `pay.csv`, click "Check the file",
    then "Import these pay records". Log out.
39. **Log in as the admin** (`acme.admin@example.com`). Click "Office team": the three demo office
    users. Click "Data requests", find `07700 900122`, open Zoe Usman, and
    click "Download (CSV, opens in Excel)": everything kept about her. (Don't delete her.)
40. **Settings.** Click "Settings". The strikes team's email, `strikes@acme-events.example`, is
    "Confirmed": records of late cancellations go there. Change it to
    `strikes.team@acme-events.example` and click "Save and send a link". It says "Saved. We've sent a
    link to that address to confirm it", and the address shows "Not confirmed". In the dev window,
    an email to that address has a link: open it and click "Confirm this address": "Confirmed. Acme
    Events can now send records of late cancellations to this address." Reload Settings: it says
    "Confirmed". Below, each site has its postcode.
41. **Connect a planner.** Click "Integrations". Under "API keys", type `Demo planner` in "Name"
    and click "Create a key". Click "Copy the key" (you won't see it again). In your second
    Ubuntu window, play the planner: paste these lines, putting the key between the quotes on the
    first one:

    ```
    KEY='paste the key here'
    DAY=$(date -d '+10 days' +%F)
    curl -X PUT "http://localhost:3000/api/v1/sessions/DEMO-STEWARD-1" \
      -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
      -d '{"event":{"ref":"DEMO-EVENT","name":"Planner demo day"},"site":{"name":"Acme Demo Arena"},"role":"steward","starts_at":"'$DAY'T10:00:00+00:00","ends_at":"'$DAY'T16:00:00+00:00","places":2,"status":"open"}'
    ```

    It answers that it was created, with the session (`{"result":"created","session":{…`). Reload Integrations: "Your planner" says
    "Connected by API", with the time of its last change. Click "Events & sessions": "Planner
    demo day" is there. Back on Integrations, click "Revoke" beside "Demo planner", then "Yes,
    revoke it":
    "Revoked. That key stopped working at once." Log out.
42. **Northline.** Go to `http://northline.localhost:3000/office/login` and log in as
    `northline.admin@example.com`. Click "Notice report": tomorrow night's possession at the
    junction has a short-notice cancellation by the office ("Weather or safety"). Log out.

**Opening the sample files.** In your second Ubuntu window, `cd .dev/walkthrough && explorer.exe . ;
cd ../..` opens the folder in Windows. In the page's file picker, go to that same folder (or drag
the file onto "Your file (.csv or .xlsx)").

## Part 4: the fake phone (the shifts line)

Workers can WhatsApp, text or ring the firm's number. Here a command plays the phone. Run these in
your second Ubuntu window while `npm run dev` runs; the replies appear in the dev window.

43. **A WhatsApp from a worker:**

    ```
    npm run -s sim:whatsapp -- --from "07700 900122" --text "Any shifts this weekend?"
    ```

    It says "WhatsApp sent to +447700900000." In the dev window, Zoe gets her own reply. It starts
    "Hi Zoe," and lists the shifts she could take at the weekend (or says there's nothing), then
    "Take one here: http://acme.localhost:3000/shifts/open", "Automatic reply. Send OFFICE to reach
    a person." and "— Acme Events Shift Team". The office sees how it was built on the message's
    Enquiries page (step 44 shows where).
44. **A WhatsApp from a number nobody has:**

    ```
    npm run -s sim:whatsapp -- --from "07700 900999" --text "Hi it's Sam, new phone"
    ```

    They get "Thanks for your message. We don't recognise this number…", and the office gets an
    email. Log in as the resourcer again (step 22) and click "Enquiries" in the menu (its count is
    the messages that need a person), then "Need a person": it's there as "Unknown number", marked
    "Passed to a person, waiting". Click "Unknown number" to see the conversation and "How it was
    answered"; you could reply in the box under it, or click "Close, no reply needed" and give a
    reason.
45. **A call with a voicemail:**

    ```
    npm run -s sim:call -- --from "07700 900122" --voicemail "Please call me about Saturday"
    ```

    It prints what the caller hears ("Thanks for calling Acme Events. We've just sent a link…").
    In the dev window, Zoe gets her login link, then "Thanks for your voicemail…" with a reference.
    In Enquiries, "Need a person" lists Zoe's voicemail. Click her name: the page warns that a
    caller's number can be faked, and "How it was answered" says a voicemail always goes to a
    person.
46. **A text:** `npm run -s sim:sms -- --from "07700 900122" --text "STOP"`. Zoe gets a text: "You
    won't get texts from Acme Events now. Reply START to turn them back on." Then
    `npm run -s sim:sms -- --from "07700 900122" --text "START"`: "Texts from Acme Events are back
    on."

## Part 5: the production-mode run

This runs the app as the server will: built once, faster, no developer tools.

47. In the dev window, press Ctrl+C. Then:

    ```
    npm run build
    ```

    It takes a few minutes and ends with a list of pages, each marked `ƒ`. If it stops with an
    error, that's a bug (use the template).
48. Start the built app, and in your second Ubuntu window the worker (it sends the messages):

    ```
    npm start
    ```

    ```
    npm run worker
    ```

    Open `http://acme.localhost:3000` and log in as in step 10: it works the same, and links are
    printed in the worker's window. If `npm start` says "the .env.example value must never be used
    in production", make your own secret: run `openssl rand -hex 32` and put what it prints after
    `SESSION_SECRET=` in `.env` (open it with `nano .env`; Ctrl+O, Enter, Ctrl+X to save and
    close). Then start both again (Ctrl+C, then `npm start` and `npm run worker`): they read `.env`
    only when they start.
49. **When you're done:** Ctrl+C in both windows. `npm run db:down` stops the database (your data
    stays until the next `npm run db:reset`). You can close Docker Desktop.

## Found a bug?

Copy this into a note or a message to Claude, one per bug:

```
Bug: (one line: what went wrong)
Step: (the step number above, e.g. 25)
Who I was logged in as: (e.g. the resourcer, or 07700 900122)
What I did: (the clicks, in order)
What I expected: (what this guide says should happen)
What happened instead: (the exact words on the screen, or the error)
Screenshot: (Windows key + Shift + S, then paste)
The dev window: (copy the last 20 lines if there's an error there)
How often: (every time / once)
```

## If something goes wrong

- **"Cannot connect to the Docker daemon"** (steps 6 and 7): open Docker Desktop and wait for
  "Engine running", then try again.
- **`npm run db:reset` fails with "connection refused":** the database isn't running: step 6.
- **The page won't load:** is the dev window still running? Start it again with `npm run dev`.
- **"Too many tries":** the login limits (3 links per number every 15 minutes, 10 a day). Wait, or
  use another demo worker, or run `npm run db:reset` for a fresh start.
- **The link says it has expired:** it works once, for 15 minutes. Ask for a new one.
- **A message doesn't appear (an offer, "Confirmed", an answer):** between 22:00 and 07:00 UK time
  the app keeps messages that aren't urgent for the morning (quiet hours). The shift's history or
  the action log says it "waits for quiet hours to end". Login links and codes always go at once.
- **Logged out unexpectedly:** use Chrome or Edge (step 9).
- **The fake phone says "Nothing is answering":** `npm run dev` isn't running. If it says it
  needs a made-up TWILIO_AUTH_TOKEN, do step 4, then restart `npm run dev`.
