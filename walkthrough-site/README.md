# ShiftDesk walkthrough page

A single web page that shows every part of ShiftDesk with real screenshots: the casual's app, the
office, payroll, running the firm, the texts, the rules and what's left. It's `index.html` plus the
`shots/` folder. There's no build step and no database, so any host that serves files can show it.

Everything in it is made-up demo data (Acme Events and Northline Rail Labour). It was made on
19 October 2026 from one scripted run of a production build (`docs/work-log.md`).

## Look at it on your computer

Open `index.html` in Chrome or Edge (double-click it). It works without the internet, except the
fonts, which then fall back to your computer's own.

## Put it on Vercel

1. Go to vercel.com and log in with your GitHub account.
2. Click **Add New…**, then **Project**.
3. Find the `casual` repository and click **Import**.
4. Next to **Root Directory**, click **Edit**, choose `walkthrough-site` and confirm.
5. Under **Framework Preset**, choose **Other**. Leave the build and output settings empty.
6. Click **Deploy**. After a minute you get an address ending in `.vercel.app`.

Anyone with that address can open the page. It holds only the made-up demo data. Each time
`walkthrough-site/` changes on `main`, Vercel puts the new version up by itself.

Netlify or GitHub Pages work the same way: point them at this folder, with no build command.
