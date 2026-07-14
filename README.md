# First Day · LP Copy Studio

A web app that turns a brief into **scored, fact-grounded landing-page copy** for First Day, following the quality system defined in the source Google Sheet.

It's a **Vercel app**: a static frontend (`index.html`) + serverless functions in `/api`, backed by **Vercel Postgres** for shared review drafts. The Anthropic key lives on the server. See [`DEPLOY.md`](DEPLOY.md) to run it (`vercel dev`) or deploy.

## What it does

1. **Syncs the sheet live** — pulls every tab from the published CSV on load (and on demand via *↻ Sync sheet*). Edit the sheet, re-sync, and the rules/evidence update automatically.
2. **Build a brief** — pick a **template** (from the Templates tab), a **product/segment**, a **problem/angle** (★ = primary, from the Problems tab), a **channel**, a working title, and an optional big promise (left blank, the AI infers and declares one).
3. **Assembles the prompt** exactly per the sheet's README workflow — bakes in the LP content requirements (R1–R7), the Copy Checks scoring rubric (R1–R6), the competitor swap test, and the credibility/differentiation assets. Only **ACTIVE** rules are included.
4. **Grounds it in evidence** — injects that product's fact-sheet nutrients (the only allowed source for dosages) plus the approved claims, statistics, and reviews matching the selected product + problem. Shown live in the *Evidence library* panel.
5. **Generates + scores** — two paths:
   - **Generate copy** — posts the assembled prompt to `/api/generate`, which calls Anthropic with the **server-side key** and renders the result inline: final copy, LP-requirement checklist, per-line Copy Check scores (0/1/2), claim→fact-sheet mapping, competitor-swap results, and a **PASS/FAIL compliance gate**.
   - **Copy full prompt** — copies the complete system + task prompt to paste into Claude manually. Works offline, no key needed.
6. **Review + draft** — send generated copy to a **separate, independent reviewer agent** (`/api/review`; it didn't write the copy, and is told to score only against the rubric + provided evidence — no hallucinated facts). It returns a **holistic 0–100 score** plus a **line-by-line breakdown**, laid out as an editable **review board**: each line gets the agent's score, notes, grounding (Fact Sheet ID or an *ungrounded* flag), and a suggested rewrite, alongside two columns the team fills in — **Accept?** and **Reviewer notes** (attributed to your name).

## Review drafts (shared)

- Each review is saved as a **draft in Vercel Postgres**, shared across the whole team — see them all via **📋 Drafts** in the header. Accepts and notes save automatically to the database, attributed to the reviewer's name (set in the Brief panel).
- A draft **stays until someone deletes it**. It **never writes to the master sheet**: promote accepted lines by editing the sheet manually, then delete the draft. **Export CSV** produces a shareable copy of the scorecard (line, score, grounding, agent notes, accept state, reviewer notes, reviewed-by) to work from.

## Generation & the API key

- The Anthropic key is a **server env var** (`ANTHROPIC_API_KEY`) — it never reaches the browser. Pick the model (Sonnet 5 / Opus 4.8 / Haiku 4.5) in **Settings**.
- Without generation configured, **Copy full prompt** / **Copy review prompt** still work — paste into Claude manually.
- If `APP_ACCESS_TOKEN` is set on the server, enter it once in **Settings** (stored only in your browser) to authorize API calls.

## Data source

Published Google Sheet (read-only), fetched as CSV per tab:

| Tab | Role |
|-----|------|
| README | The quality-system spec the app implements |
| Templates | Page templates + their composition (Listicle, Behind the Science, Broad PDP) |
| LP_Checks | Holistic whole-page requirements R1–R7 (must be present) |
| Module_Checks | Per-section requirements (each module must pass) |
| Copy_Checks | Per-line rules — every h1/h2/h3/p must satisfy **all of 1–3 and at least one of 4–6** (0/1/2) |
| Problems | Product × problem taxonomy, with primary (★) flag — drives the angle picker |
| Hooks / Claims / Quotes | Pre-approved evidence, tagged by product + problem (Quotes = customer/pediatrician) |
| Product_Info | Products, SKUs, nutrient dosages, links (the only source for dosages) |

The three grading layers (LP_Checks holistic → Module_Checks per section → Copy_Checks per line) are applied in both generation and the independent review. Only **ACTIVE**-status rules are used.

The app is **read-only against the sheet** — it never writes back to the sheet or any First Day platform. (Review drafts are the app's own data, stored in its Postgres database, not the sheet.)

## Architecture

- **Frontend** (`index.html`): syncs the sheet, assembles prompts, renders results + the review board. Talks to its own `/api`.
- **`/api/generate`, `/api/review`**: proxy the assembled prompt to Anthropic with the server-side key (structured-output tools in `lib/tools.js`).
- **`/api/drafts`, `/api/drafts/[id]`**: CRUD for shared review drafts in Vercel Postgres (`lib/db.js`; tables auto-created on first request).
- **`lib/auth.js`**: optional `APP_ACCESS_TOKEN` gate on every API call.

## Notes

- The Google Sheet is fetched client-side; its published-CSV endpoint returns `Access-Control-Allow-Origin: *`, so the browser can read it directly.
- Run with `vercel dev`; deploy with `vercel` / `vercel --prod`. See [`DEPLOY.md`](DEPLOY.md).
- Only external dependency is `@vercel/postgres`; the CSV parser, prompt assembly, and rendering are still hand-rolled.
# app-lp-copy-creation
# app-lp-copy-creation
