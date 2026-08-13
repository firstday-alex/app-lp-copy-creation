# First Day · LP Copy Studio

A web app that turns a brief into **scored, fact-grounded landing-page copy** for First Day, following the quality system defined in the source Google Sheet.

It's a **Vercel app**: a static frontend (`index.html`) + serverless functions in `/api`, backed by **Vercel Postgres** for shared review drafts. The Anthropic key lives on the server. See [`DEPLOY.md`](DEPLOY.md) to run it (`vercel dev`) or deploy.

## What it does

1. **Syncs the sheet live** — pulls every tab from the published CSV on load (and on demand via *↻ Sync sheet*). Edit the sheet, re-sync, and the rules/evidence update automatically.
2. **Build a brief** — pick a **template** (from the Templates tab), a **product/segment**, a **problem/angle** (★ = primary, from the Problems tab), a **channel**, a working title, and an optional big promise (left blank, the AI infers and declares one).
3. **Assembles the prompt** exactly per the sheet's README workflow — bakes in the LP content requirements (R1–R7), the Copy Checks scoring rubric (R1–R6), the competitor swap test, and the credibility/differentiation assets. Only **ACTIVE** rules are included.
4. **Grounds it in evidence** — injects that product's fact-sheet nutrients (the only allowed source for dosages) plus the approved claims, statistics, and reviews matching the selected product + problem. Shown live in the *Evidence library* panel.
5. **Four modes** — *✍️ Write new* (a whole page from a brief), *🔍 Grade page* (score a live page and rewrite it), *🧩 One module*, and *📄 Live page* (write copy into a real Shopify page's slots) — the last two are below.
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

## Live page (📄 mode)

Instead of writing a page from a brief, this reads a page that already exists, breaks it into the individual copy slots it's made of, and writes into them one at a time. **Read-only against Shopify** — it never writes back.

1. **Pick a page in the Template dropdown.** In this mode that dropdown lists the live store instead of the sheet — **★ Saved** first, then **Theme page templates** (`templates/page.*.json` from the published theme), then **Online Store pages**. Needs `SHOPIFY_STORE_DOMAIN` + `SHOPIFY_ADMIN_TOKEN` on the server; see [`DEPLOY.md`](DEPLOY.md).
2. **Read the page.** It comes back as an outline of copy slots — headings, body, bullets, CTAs, quotes, image alt text — nested so a heading owns what follows it. Slots that exist but have never been written are marked **empty**; that state is the point of the mode, so blank copy is kept, never pruned.
3. **Write slots.** *Write empty slots* fills every unwritten one; *Write selected* takes whatever you tick. Each slot gets 1–5 options: **option 1 stays closest to what's live**, each later one is a bigger swing. Click an option to take it, or type your own.

   Writes are **batched automatically**, because the response is `slots × variants × rules`, not `slots`. A whole section's worth of fields in one request needs more output tokens than the model's ceiling allows: it generates until the serverless function is killed and returns *nothing*. So the client splits the work into passes sized by that product, runs two at a time, and renders each pass's options as it lands — a failure late in a long run never costs the earlier passes. The first pass runs alone because it establishes the page promise every later pass is told to write to; without that, each batch invents its own angle and the page stops arguing one thing.

   Two independent ceilings, both defined once in `lib/outline.js` and published via `?op=status` so client and server can't drift: `SLOT_UNIT_BUDGET` (36 lines of copy per pass — the token limit) and `SLOT_MAX_PER_PASS` (14 slots — because 14 is about as many as the model attends to individually, however well they fit).
4. **Everything is graded.** Options are scored against **Copy_Checks**, grounded against the fact sheet and approved evidence, checked for length against the slot's kind, and passed through the competitor swap test — the same bar as every other mode. A fact the model needed and didn't have shows up inline as `[VERIFY: …]` rather than being guessed at.
5. **Drafts autosave** to Postgres, shared with the team, keyed by the slot's id. Each records the store copy as it stood when written, so if the live page changes underneath a draft the slot is flagged **store changed** instead of one silently overwriting the other.
6. **Export** the outline as **Markdown** (drafts substituted in, empty slots flagged, replaced copy kept as a comment) or **JSON** (every slot with its `path`, store copy, draft and status).

### How a page becomes slots

Both sources normalise to one shape, `OutlineNode[]`, and `kind` is what drives everything downstream — length rules, badges, export formatting.

Theme templates are the harder half: section setting keys are theme-defined, so there's no schema to read. Each string setting is classified copy-vs-config by three ordered rules — key hints (`heading` → h2, `button_label` → cta), then rejection of config *values* (hex colours, `shopify://`, URLs, numbers-with-units, booleans), then rejection of single all-lowercase tokens (`center`, `adapt`, `h2`). **The order is load-bearing**: key hints run first so `image_alt` survives despite containing "image", and the enum rejection runs last so `text_alignment: "center"` is caught even though its key hints as text. Rich-text settings are exploded into paragraphs and links; the same `heading` key is an h2 at section level and an h3 inside a block; all-config sections are dropped.

Both parsers are heuristics, which is why `GET /api/outline?op=selftest` runs 26 fixture checks against them and returns markdown — **no store, key or database needed**. Changing a heuristic means adding a case proving the new behaviour is caught *and* the old ones still are. That discipline has already caught five structural bugs, including blocks nesting under whichever settings key happened to sort last.

The `path` on each slot (`sections.problem.blocks.b2.settings.text`) is a write-back target that nothing uses yet. Write-back would be a deliberate, separate feature — `write_themes`, diff-and-confirm, backup-first — not a loosened check. `lib/shopify.js` refuses any GraphQL document containing `mutation` before it reaches the network.

## Saved templates (⭐)

Bookmark a page or template and it does two things: it lands in **⭐ Saved** in the header, and it gets **pinned to the top of the Template dropdown** under a `★ Saved` group, so the pages a writer keeps returning to are the first thing in the list rather than buried among every template in the theme. A saved source appears once — pinned at the top, not also down in its own group.

Each bookmark stores a **snapshot of its outline**, so opening it is instant and works even when the store is unreachable. *Re-read from the live store* refreshes it and flags any slot whose copy has moved since a draft was written. If a saved source can't be confirmed live — removed from the theme, or the theme didn't load — selecting it opens the snapshot and says so, rather than failing on a read that can't succeed.

One control means one thing: in the other three modes the Template dropdown is still the sheet's page shapes. In 📄 Live page mode the real page's own section order **is** the shape, and that's what gets passed to the writer — a more honest description than a composition string.

Removing a bookmark removes the shortcut, **not the copy**: slot drafts are keyed independently of bookmarks, so a writer can draft into a page without saving it, and re-saving later brings the work back. (`DELETE /api/bookmarks/:id?purgeDrafts=1` is the explicit "throw the copy away too" path.)

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

The app is **read-only against the sheet** — it never writes back to the sheet or any First Day platform. The same holds for Shopify in 📄 Live page mode: it reads the published theme and Online Store pages, and writes nothing. (Review drafts, slot drafts and saved templates are the app's own data, stored in its Postgres database.)

## Architecture

- **Frontend** (`index.html`): syncs the sheet, assembles prompts, renders results + the review board. Talks to its own `/api`.
- **`/api/generate`, `/api/audit`, `/api/review`**: proxy the assembled prompt to Anthropic with the server-side key (structured-output tools in `lib/tools.js`).
- **`/api/module`**: the one-module pass. Takes the assembled prompt plus base64 images and sends them as vision content blocks (images before the text block, per the Messages API). Validates media type, image count, and total payload size against the 4.5MB serverless body limit before calling out.
- **`/api/drafts`, `/api/drafts/[id]`**: CRUD for shared review drafts in Vercel Postgres (`lib/db.js`; tables auto-created on first request).
- **`/api/outline`**: 📄 Live page's reads, behind an `op` — `status`, `sources`, `template`, `page`, `export`, `selftest`. The parsers run server-side so there is one implementation of the copy-vs-config heuristics; the browser sends a selector and renders a tree.
- **`/api/slots`**: the per-slot writer. Proxies the assembled prompt with `SLOTS_SCHEMA`, then **re-measures every returned variant** against its kind's word range — stating a length rule in a prompt isn't enforcing one — and merges inline `[VERIFY: …]` markers into each variant's `verify` list. Enforces both batch ceilings, and its rejections quote the real limit for the option count in play rather than a generic "too many". `copy_checks` carries a justification only where a rule scored 0 or 1: a justification for a rule that passed is the single largest thing in the response and says nothing a reader needs, and buying it back roughly tripled how much fits in a pass.
- **`/api/slot-drafts`, `/api/bookmarks`, `/api/bookmarks/[id]`**: slot copy and saved templates.
- **`lib/outline.js`**: the `OutlineNode` model, both parsers, per-kind length rules, and the Markdown/JSON exports. **`lib/selftest.js`**: their fixtures.
- **`lib/shopify.js`**: read-only Admin API client (2025-10). Fetches the published theme by `roles: [MAIN]` rather than paging the theme list — stores accumulate themes and `themes(first: 25)` reliably misses the live one — and handles all three shapes of the theme-file body union (text, base64, URL).
- **`lib/auth.js`**: optional `APP_ACCESS_TOKEN` gate on every API call.

## Notes

- The Google Sheet is fetched client-side; its published-CSV endpoint returns `Access-Control-Allow-Origin: *`, so the browser can read it directly.
- Run with `vercel dev`; deploy with `vercel` / `vercel --prod`. See [`DEPLOY.md`](DEPLOY.md).
- Only external dependency is `@vercel/postgres`; the CSV parser, the HTML/theme-JSON parsers, prompt assembly, and rendering are all hand-rolled.
- `GET /api/outline?op=selftest` returns the parser fixture report as markdown and exits non-zero on failure — the fastest check that a heuristic change didn't break anything.
# app-lp-copy-creation
# app-lp-copy-creation
