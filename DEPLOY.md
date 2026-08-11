# Deploying LP Copy Studio to Vercel

The app is a static frontend (`index.html`) plus serverless functions in `/api`, backed by **Vercel Postgres**. The Anthropic key lives on the server — it never reaches the browser.

## 1. Prerequisites

- A Vercel account and the CLI: `npm i -g vercel`
- An Anthropic API key

## 2. Link the project

From this folder:

```bash
vercel link          # create/link a Vercel project
```

## 3. Add the database

In the Vercel dashboard → your project → **Storage** → **Create** → **Postgres**, then connect it to the project.
This automatically adds the `POSTGRES_URL` (and related) environment variables. No manual migration is needed — the tables are created on first request (`create table if not exists`).

To also use them locally, pull them down:

```bash
vercel env pull .env.local
```

## 4. Set the environment variables

In the Vercel dashboard → **Settings** → **Environment Variables** (or via CLI), set:

| Variable | Required | What it is |
|----------|----------|------------|
| `ANTHROPIC_API_KEY` | ✅ | Your Anthropic key. Server-side only. |
| `POSTGRES_URL` | ✅ (auto) | Added when you attach Postgres. |
| `SHOPIFY_STORE_DOMAIN` | for 📄 Live page | The `*.myshopify.com` admin domain. A full URL or a trailing slash is fine — it gets normalised. |
| `SHOPIFY_ADMIN_TOKEN` | for 📄 Live page | Admin API access token, server-side only. |
| `APP_ACCESS_TOKEN` | optional | If set, the app requires this token (entered once in **Settings**) on every API call. Leave unset to keep it open and use Vercel's own deployment protection instead. |

See `.env.example` for the shape. Without the two Shopify variables every other mode works normally and 📄 Live page says what's missing instead of failing obscurely.

### Shopify access (📄 Live page mode only)

In the Shopify admin → **Settings** → **Apps and sales channels** → **Develop apps** → **Create an app**, then under **Configuration** → **Admin API integration** grant exactly two scopes:

| Scope | Why |
|-------|-----|
| `read_themes` | list the published theme's files and read `templates/page.*.json` |
| `read_content` | list Online Store pages and read their bodies |

Install the app and copy the **Admin API access token** into `SHOPIFY_ADMIN_TOKEN`.

Grant nothing else. `lib/shopify.js` rejects any GraphQL document containing `mutation` before it reaches the network, so a write scope would be dead weight and a live-store liability. Verify with:

```bash
curl -s localhost:3000/api/outline?op=selftest    # parsers only — no store, no key, no DB
```

## 5. Run locally / deploy

```bash
vercel dev           # local: serves index.html + /api on http://localhost:3000
vercel               # deploy a preview
vercel --prod        # deploy to production
```

> Opening `index.html` directly as a `file://` won't reach `/api` — use `vercel dev`. The offline **Copy full prompt** / **Copy review prompt** buttons still work either way.

## Security note

`/api/generate` and `/api/review` proxy prompts to Anthropic using the server key, so anyone who can reach the deployment can spend against that key. Protect the deployment with **either**:

- `APP_ACCESS_TOKEN` (shared token, entered in Settings), and/or
- Vercel's built-in **Deployment Protection** (Vercel Authentication / password) under project Settings.

The app is read-only against the master Google Sheet and **never writes back to it** — promotion of accepted lines stays a manual step. The same holds for Shopify: 📄 Live page reads the published theme and Online Store pages and writes nothing back. Slot copy lands in the app's own Postgres and gets to the store however the team already ships copy.

> Vercel's Hobby plan caps a deployment at 12 serverless functions. This app now has 11 (`generate`, `audit`, `module`, `review`, `outline`, `slots`, `slot-drafts`, `drafts/index`, `drafts/[id]`, `bookmarks/index`, `bookmarks/[id]`). Adding two more routes means consolidating behind an `op` parameter — which is why `/api/outline` already works that way.
