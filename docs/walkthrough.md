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

"Log out" is at the bottom of My shifts (`http://acme.localhost:3000/`); for the office, at the
bottom of Today. The worker's side is made for phones. In Chrome you can see it as a phone: press
F12, then Ctrl+Shift+M (press them again to go back). Each worker below is a made-up person from
the demo.

10. **Log in as Zoe Usman** (a steward who isn't booked on anything). Go to
    `http://acme.localhost:3000/login`. Type `07700 900122` in "Your mobile number" and click
    "Send me a link". The page says "Check your phone." In the dev window, a WhatsApp to
    `+44*******122` says "Here's your Acme Events shifts link…": open that link, then click
    "Log me in". You see "Hello Zoe" and "No shifts booked yet."
11. **Take a shift.** Click "See open shifts". The coming Saturday's open steward shifts are
    listed. On the one at "Acme Demo Arena", click "Take shift". It says "You're booked." with a
    reference and "— Acme Events Shift Team".
12. **Cancel it.** Click "See my shifts". Under "Your next shift", click "Cancel this shift",
    choose "I'm unwell", then "Confirm cancellation". It says "We've recorded your cancellation."
    and the notice you gave. Click "Back to my shifts": "No shifts booked yet." again.
13. **Your pay.** Click "See your pay", then "Send me a code". A 6-digit code arrives in the dev
    window ("Your Acme Events code is …"). Type it in "Your code" and click "Check code". You see
    "The last 8 weeks, from Acme Events's payroll." with the hours and rates.
14. **Raise a pay query.** On the pay page, click "Raise a pay query". In "Which shift?" choose "A
    day not in the list", pick any day last week in "Which day?", choose "Paid late or not paid",
    type a note if you like, and click "Send pay query". It says "Pay query sent." with a
    reference.
15. **Your profile.** Go to `http://acme.localhost:3000/`, click "My profile". Zoe's "Level 2
    spectator safety qualification" shows as Valid. Mark a day you can't work, then "Remove" it.
    Go back to My shifts and click "Log out".
16. **Log in as Sam Walsh** (`07700 900110`), a steward booked on Saturday. "Your next shift"
    shows it, with the day's "Instructions" under it. Click "Past 30 days": yesterday's race day
    at "Acme Demo Racecourse" is listed. Click "Upcoming" to go back.
17. **Ask for a change.** On My shifts, click "Ask for a change", choose "Change the times", set
    "New start" to 13:00 and "New finish" to 18:30, and click "Send request". It says "Request
    sent." Click "See my requests": it's "Waiting for the office". Log out.
18. **Log in as Maya Morgan** (`07700 900129`), a door supervisor whose SIA licence has expired.
    A red banner on My shifts says so. Open the urgent shift's page: the link printed at the end
    of `npm run db:reset` (step 7; it isn't in her open shifts, because she can't take it). It
    says "You can't take this shift:" and why. Click "Ask the office to review": it gives a
    reference. Log out.
19. **Log in as Wes Doyle** (`07700 900139`), a door supervisor with a valid licence. My shifts
    says "1 urgent shift needs someone" (2 from Friday noon: Zoe's cancelled shift is then less
    than a day away, so it's urgent too). Click "See urgent shifts", then "Take shift" on the 08:00
    arena shift: "You're booked." Log out.

## Part 3: as the office

The office is made for a laptop or desktop: if you switched Chrome to a phone view, press F12
again to go back.

20. **Log in as the resourcer.** Go to `http://acme.localhost:3000/office/login`, type
    `acme.resourcer@example.com` in "Your work email", and click "Send me a link". In the dev
    window an email ("Your Acme Events office login link") has the link: open it, then click "Log
    me in". You see "Today".
21. **Today.** It shows Saturday's gaps ("Gaps in the next 7 days"), "4 requests waiting: 2 time
    changes, 1 swap, 1 review of a refused shift." (Sam's and the demo's time changes, the demo's
    swap, Maya's review), "Who worked?" (yesterday's 5 bookings, not marked yet), and what was
    cancelled in the last 24 hours (Zoe's).
22. **Offer a gap.** Under "Gaps in the next 7 days", on a shift, click "Offer to someone", then
    "Send offer to …" on the first person. It says "Offer on its way to …", and the offer appears
    in the dev window. Click "Back to Today".
23. **Answer a request.** Click "Requests". On Sam Walsh's time change, click "Approve and tell
    Sam". It says "Approved. Sam will be told." The message to Sam appears in the dev window.
24. **Mark who worked.** Go back to Today. Under "Who worked?", open one of yesterday's
    racecourse shifts. Click "Mark as worked" for the person on it: "Marked … as worked." (On a
    shift with several people, "Mark as not attended" and "Mark the … not marked yet as worked"
    are there too.)
25. **Make a shift and book someone.** Click "Shifts", then "New shift". Pick a date next week,
    Role "steward", Start 10:00, Finish 18:00, Places 2, and click "Create shift". On the new
    shift's page, under "Assign someone", choose a person in "Who?" and click "Check" (if it says
    they can't work it, and why, choose someone else), then "Assign …". It says "… is booked on this shift. They'll get a message to say so.", and the "Confirmed:
    …" message appears in the dev window.
26. **Move it, then cancel the booking.** Under "Move, shorten or cancel", set "New start" to 11:00
    and "New finish" to 19:00, choose the reason "The event's times or place changed", and click
    "Move for everyone booked". It says "Moved. 1 person booked will be told." Then click "Cancel
    …'s booking", choose "Weather or safety", and click "Yes, cancel …'s booking": "Cancelled
    …'s booking with … notice. They'll be told."
27. **A whole event, and an import.** Click "Shifts", then "Shifts for an event": pick a date and
    fill in two lines (for example a steward 08:00 to 16:00 and a door supervisor 20:00 to 04:00),
    then click "Create these shifts". It says "2 shifts created." Then make the sample files in
    your second Ubuntu window:

    ```
    npm run -s walkthrough:files
    ```

    On "Shifts", click "Import from a file", choose `shifts.csv` (see "Opening the sample files"
    below), click "Check the file", then "Import these shifts".
28. **Workers.** Click "Workers", type `Zoe` in "Name or mobile number", and click "Find". Open Zoe
    Usman: her bookings, licences and access. (Don't make her inactive: later steps use her.)
29. **The action log.** Click "Action log". Everything you've done is there, newest first. Choose
    Type "Cancellations" and click "Show".
30. **The notice report.** Click "Notice report". The cancellations are listed with the notice each
    worker had, short notice flagged (under 48 hours). Click "Download as a spreadsheet (CSV)" to
    see the file.
31. **Pilot metrics.** Click "Pilot metrics". Under "Baseline (week 0)", fill in "Staff emails per
    day" (say 40) and click "Save the baseline": "Baseline saved." Then click "Log out".
32. **Log in as payroll** (`acme.payroll@example.com`, as in step 20). Click "Pay queries". The
    queries are grouped by likely cause, biggest first: 7 stewards about one week's rate, 2 about
    hours missing at the shopping centre, 1 "something else", and Zoe's "paid late" from step 14.
    Click "Send the digest now": it says how many new queries it's sending, and an email with the
    list attached appears in the dev window. (On a weekday after 09:00, the day's digest goes by
    itself soon after `npm run dev` starts: then "Send the digest now" sends only the ones since.)
33. **Answer a group.** On the stewards' rate group, type a note in "Tell them what payroll did"
    (for example "We've added the difference to Friday's pay.") and click "Mark as sorted and tell
    them". Each of them is told (the dev window).
34. **Import pay records.** Click "Import pay records", choose `pay.csv`, click "Check the file",
    then "Import these pay records". Log out.
35. **Log in as the admin** (`acme.admin@example.com`). Click "Office team": the three demo office
    users. Click "Data requests (download or delete)", find `07700 900122`, open Zoe Usman, and
    click "Download (CSV, opens in Excel)": everything kept about her. (Don't delete her.) Log out.
36. **Northline.** Go to `http://northline.localhost:3000/office/login` and log in as
    `northline.admin@example.com`. Click "Notice report": tomorrow night's possession at the
    junction has a short-notice cancellation by the office ("Weather or safety"). Log out.

**Opening the sample files.** In your second Ubuntu window, `cd .dev/walkthrough && explorer.exe . ;
cd ../..` opens the folder in Windows. In the page's file picker, go to that same folder (or drag
the file onto "Your file (.csv or .xlsx)").

## Part 4: the fake phone (the shifts line)

Workers can WhatsApp, text or ring the firm's number. Here a command plays the phone. Run these in
your second Ubuntu window while `npm run dev` runs; the replies appear in the dev window.

37. **A WhatsApp from a worker:**

    ```
    npm run -s sim:whatsapp -- --from "07700 900122" --text "Any shifts this weekend?"
    ```

    It says "WhatsApp sent to +447700900000." In the dev window, Zoe gets "Open shifts you're
    eligible for: http://acme.localhost:3000/shifts/open — Acme Events Shift Team".
38. **A WhatsApp from a number nobody has:**

    ```
    npm run -s sim:whatsapp -- --from "07700 900999" --text "Hi it's Sam, new phone"
    ```

    They get "Thanks for your message. We don't recognise this number…", and the office gets an
    email. Log in as the resourcer again (step 20): Today shows it under "Messages from numbers we
    don't know".
39. **A call with a voicemail:**

    ```
    npm run -s sim:call -- --from "07700 900122" --voicemail "Please call me about Saturday"
    ```

    It prints what the caller hears ("Thanks for calling Acme Events. We've just sent a link…").
    In the dev window, Zoe gets her login link, then "Thanks for your voicemail…" with a reference.
    The office's Requests page shows the voicemail.
40. **A text:** `npm run -s sim:sms -- --from "07700 900122" --text "STOP"`. Zoe gets a text: "You
    won't get texts from Acme Events now. Reply START to turn them back on." Then
    `npm run -s sim:sms -- --from "07700 900122" --text "START"`: "Texts from Acme Events are back
    on."

## Part 5: the production-mode run

This runs the app as the server will: built once, faster, no developer tools.

41. In the dev window, press Ctrl+C. Then:

    ```
    npm run build
    ```

    It takes a few minutes and ends with a list of pages, each marked `ƒ`. If it stops with an
    error, that's a bug (use the template).
42. Start the built app, and in your second Ubuntu window the worker (it sends the messages):

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
43. **When you're done:** Ctrl+C in both windows. `npm run db:down` stops the database (your data
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
