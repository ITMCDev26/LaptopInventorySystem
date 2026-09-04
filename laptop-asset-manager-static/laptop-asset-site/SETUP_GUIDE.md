# Laptop Asset Manager — Plain HTML/CSS/JS Setup

This version is a normal static website — `index.html`, `style.css`,
`script.js` — that you can host anywhere (GitHub Pages, Netlify, a plain
folder, your intranet). It talks to a small **Google Apps Script API**
that reads and writes directly to your Google Sheet. No database, no paid
hosting required for the backend.

## Part 1 — Backend (Google Apps Script API)

1. Go to sheets.google.com → **Blank spreadsheet** → rename it, e.g.
   **"Laptop Asset Registry"**.
2. **Extensions → Apps Script**. Delete the default code.
3. Paste in the contents of `Code.gs` (included here).
4. Save (💾).
5. Run setup once:
   - In the function dropdown, select **`setupSheets`** → click **Run**.
   - Authorize when prompted (Review permissions → your account →
     Advanced → Go to project (unsafe) → Allow — this is normal for your
     own scripts).
   - A popup confirms setup and gives you the default login:
     **Username:** `admin` · **Password:** `admin123`
   - Your sheet now has 3 tabs: `Users`, `Laptops`, `History`.
6. **Deploy → New deployment → 🔧 (gear) → Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone** (needed for the static site to call it from
     a browser) — or **Anyone within [org]** if you're on Google
     Workspace and want it restricted to your org.
   - Click **Deploy**, authorize again if asked.
   - **Copy the Web app URL.** This is your API endpoint.

## Part 2 — Frontend (the static site)

1. Open `script.js`.
2. At the very top, replace:
   ```js
   const API_URL = 'PASTE_YOUR_DEPLOYED_WEB_APP_URL_HERE';
   ```
   with the Web app URL you copied in step 6 above.
3. That's it — open `index.html` in a browser (double-click it, or host
   the folder anywhere) and log in with `admin` / `admin123`.

### Hosting the static files
Any of these work — pick whichever is easiest for you:
- **Just open the file** — double-click `index.html` locally. Fine for
  a single user testing it out.
- **GitHub Pages** — push the folder to a repo, enable Pages in repo
  settings, done.
- **Netlify / Vercel** — drag-and-drop the folder into their dashboard.
- **Your office intranet / any static file server** — copy the 3 files
  to it.

No build step, no npm install — it's plain HTML/CSS/JS.

## Change the default password
Go to the Apps Script editor, run this once from a scratch function (or the
built-in `hashPassword` helper) to generate a new hash, then paste it into
the `PasswordHash` column of the `Users` tab in your sheet:
```js
function getHash(){
  Logger.log(hashPassword('yourNewPassword'));
}
```
Run it, check **View → Logs** for the hash, copy it into the sheet.

## How the data model works
- **Laptops** tab — one row per physical laptop: Control Number (CAD),
  Serial No., Brand, Model, PO Number, Date Purchased, current Accountable
  Employee + Employee No. + Township/Unit, Status (`Active` /
  `Pending Reassignment` / `Retired`), Remarks.
- **History** tab — one row per event (registration, transfer, resignation)
  — searching a serial number replays its full chain of custody.
- **Users** tab — admin login accounts (SHA-256 hashed, never plaintext).

## Feature summary
- **Login** — admin auth, 6-hour sessions (adjust `TOKEN_TTL_SECONDS` in
  `Code.gs`), session persists across page refresh via `sessionStorage`.
- **Dashboard** — total/active/pending/aging-past-4.5-years counts, recent
  activity feed, fleet-by-brand bar chart.
- **Register Laptop** — Accountable Employee, Employee No., Township/Unit,
  Brand/Model, Serial No., PO Number, Date Purchased, Control Number (CAD),
  Remarks.
- **Transfer / Exit** — look up by serial/control number, then (a) New
  Assignment or (b) Resigned. Resignation marks the laptop `Pending
  Reassignment`, logs the return, and opens a printable exit-clearance slip.
- **Search** — by Serial/Control No. (full ownership timeline) or Employee
  No. (everything that person is accountable for).
- **All Inventory** — full sortable table.

## Why the request body isn't `Content-Type: application/json`
Apps Script Web Apps don't handle CORS preflight (`OPTIONS`) requests, so
`script.js` deliberately sends the POST body without setting a custom
`Content-Type` header — that keeps it a "simple request" the browser
doesn't preflight, while `Code.gs`'s `doPost` still parses
`e.postData.contents` as JSON just fine. Don't add
`headers: {'Content-Type': 'application/json'}` to the fetch call in
`script.js` or requests will start failing silently.

## Troubleshooting
- **Nothing loads / CORS error in console** — double check `API_URL` in
  `script.js` matches your deployed Web app URL exactly, and that the
  deployment's access is set to "Anyone."
- **"Invalid username or password"** — confirm the `Users` sheet has the
  `admin` row with a `PasswordHash` (not a plaintext password).
- **Redeploying after editing `Code.gs`** — Apps Script Web app URLs stay
  the same across **Deploy → Manage deployments → ✏ Edit → New version**;
  you don't need to update `API_URL` again after that.
