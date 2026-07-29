# First Day · LP Copy Studio

A web app that turns a brief into **scored, fact-grounded landing-page copy** for First Day, following the quality system defined in the source Google Sheet.

It's a **Vercel app**: a static frontend (`index.html`) + serverless functions in `/api`, backed by **Vercel Postgres** for shared review drafts. The Anthropic key lives on the server. See [`DEPLOY.md`](DEPLOY.md) to run it (`vercel dev`) or deploy.

## What it does

1. **Syncs the sheet live** — pulls every tab from the published CSV on load (and on demand via *↻ Sync sheet*). Edit the sheet, re-sync, and the rules/evidence update automatically.
2. **Build a brief** — pick a **template** (from the Templates tab), a **product/segment**, a **problem/angle** (★ = primary, from the Problems tab), a **channel**, a working title, and an optional big promise (left blank, the AI infers and declares one).
3. **Assembles the prompt** exactly per the sheet's README workflow — bakes in the LP content requirements (R1–R7), the Copy Checks scoring rubric (R1–R6), the competitor swap test, and the credibility/differentiation assets. Only **ACTIVE** rules are included.
4. **Grounds it in evidence** — injects that product's fact-sheet nutrients (the only allowed source for dosages) plus the approved claims, statistics, and reviews matching the selected product + problem. Shown live in the *Evidence library* panel.
5. **Three modes** — *✍️ Write new* (a whole page from a brief), *🔍 Grade page* (score a live page and rewrite it), and *🧩 One module* (below).
6. **Generates + scores** — two paths:
   - **Generate copy** — posts the assembled prompt to `/api/generate`, which calls Anthropic with the **server-side key** and renders the result inline: final copy, LP-requirement checklist, per-line Copy Check scores (0/1/2), claim→fact-sheet mapping, competitor-swap results, and a **PASS/FAIL compliance gate**.
   - **Copy full prompt** — copies the complete system + task prompt to paste into Claude manually. Works offline, no key needed.
7. **Review + draft** — send generated copy to a **separate, independent reviewer agent** (`/api/review`; it didn't write the copy, and is told to score only against the rubric + provided evidence — no hallucinated facts). It returns a **holistic 0–100 score** plus a **line-by-line breakdown**, laid out as an editable **review board**: each line gets the agent's score, notes, grounding (Fact Sheet ID or an *ungrounded* flag), and a suggested rewrite, alongside two columns the team fills in — **Accept?** and **Reviewer notes** (attributed to your name).

## One module (🧩 mode)

Same loop as the LP, scoped to a **single module** and driven by an **image of the first version** instead of pasted text.

1. **Name the module** (Hero, 3 Reasons Why, Behind the Science…) and optionally say **where it sits** — what comes before and after. That's what the *"does it connect to the previous section?"* module rule is scored against; leave it blank and the model says what it assumed.
2. **Upload the first version** — drag/drop, click, or **paste a screenshot** straight from the clipboard (up to 4 images, e.g. a module split across two grabs). Images are downscaled client-side to a 2000px long edge only when they exceed it, so small type stays legible; anything already small is sent untouched. Optionally paste the module's copy as text too — then wording is quoted exactly and the image is used for the visual and the hierarchy.
3. **`/api/module` reads the image** (vision) and runs the full loop in one pass: *read → grade → rewrite → re-check*.
   - **Read** — what's pictured, every line transcribed verbatim with its type, the reading hierarchy, and what a parent gets in **one second**. Unreadable lines are flagged, not guessed at.
   - **Grade** the first version 0–100 against every rule on **Module_Checks** plus the per-line Copy_Checks.
   - **Rewrite** it into headline / subhead / body / bullets / CTA, plus a **visual direction** — the specific, ownable moment the image should show for the copy to land.
   - **Re-check the rewrite** against the same module rules and Copy_Checks, reported separately from the first version's scores, alongside the competitor swap test, claim→fact-sheet mapping, and the PASS/FAIL gate.
4. **Independent check** — *Send module for independent check* runs the rewrite past the same separate reviewer agent used for LPs, scoped to one module (it never sees the v1 image, so it scores the new copy on the rules and evidence alone) and saves it as a shared review draft with the same accept / notes / CSV board.

**Module rules are the one exception to ACTIVE-only.** The per-module rules live on the **Module_Checks** tab (there is no tab named `module_rules`). Four of its nine rows — **2, 7, 8, 9** — have no `ACTIVE` status, so the sheet's *"only ACTIVE rules apply"* convention would silently drop a third of the module rubric, including header/paragraph congruency and the mobile-fold check. So **all nine module rules are graded and gating**, in every mode that grades modules: *Write new*, *Grade page*, *One module*, and both reviewer passes. A 0 on any of them blocks the compliance gate.

Only `Module_Checks` gets this treatment — `LP_Checks` and `Copy_Checks` are fully `ACTIVE` in the sheet and still follow the ACTIVE-only rule. The Brief panel states the divergence in every mode; setting `Status` to `ACTIVE` on those four rows makes the sheet agree with what the app already enforces.

Most module rules are written as a bare question with no `Score 0/1/2 =` anchors (only rule 1 has them). The prompts say which rules have anchors so those get applied literally, and instruct the model to score the unanchored ones 2 / 1 / 0 on whether the module clearly, partly, or doesn't satisfy the question — and to state what it judged that on. Filling in the anchor columns in the sheet will tighten those scores.

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
| Module_Checks | Per-module requirements (each module must pass) — **all rows apply regardless of Status**, see [One module](#one-module--mode) |
| Copy_Checks | Per-line rules — every h1/h2/h3/p must satisfy **all of 1–3 and at least one of 4–6** (0/1/2) |
| Problems | Product × problem taxonomy, with primary (★) flag — drives the angle picker |
| Hooks / Claims / Quotes | Pre-approved evidence, tagged by product + problem (Quotes = customer/pediatrician) |
| Product_Info | Products, SKUs, nutrient dosages, links (the only source for dosages) |

The three grading layers (LP_Checks holistic → Module_Checks per module → Copy_Checks per line) are applied in generation, the audit, and the independent review. Only **ACTIVE**-status rules are used — **except on Module_Checks**, where every row applies (see above).

The app is **read-only against the sheet** — it never writes back to the sheet or any First Day platform. (Review drafts are the app's own data, stored in its Postgres database, not the sheet.)

## Architecture

- **Frontend** (`index.html`): syncs the sheet, assembles prompts, renders results + the review board. Talks to its own `/api`.
- **`/api/generate`, `/api/audit`, `/api/review`**: proxy the assembled prompt to Anthropic with the server-side key (structured-output tools in `lib/tools.js`).
- **`/api/module`**: the one-module pass. Takes the assembled prompt plus base64 images and sends them as vision content blocks (images before the text block, per the Messages API). Validates media type, image count, and total payload size against the 4.5MB serverless body limit before calling out.
- **`/api/drafts`, `/api/drafts/[id]`**: CRUD for shared review drafts in Vercel Postgres (`lib/db.js`; tables auto-created on first request).
- **`lib/auth.js`**: optional `APP_ACCESS_TOKEN` gate on every API call.

## Notes

- The Google Sheet is fetched client-side; its published-CSV endpoint returns `Access-Control-Allow-Origin: *`, so the browser can read it directly.
- Run with `vercel dev`; deploy with `vercel` / `vercel --prod`. See [`DEPLOY.md`](DEPLOY.md).
- Only external dependency is `@vercel/postgres`; the CSV parser, prompt assembly, and rendering are still hand-rolled.
# app-lp-copy-creation
# app-lp-copy-creation
