// Read-only Shopify Admin API client. Server-side only — the token lives in
// SHOPIFY_ADMIN_TOKEN and never reaches the browser, same arrangement as the Anthropic key.
//
// Scopes needed on the custom app: read_themes + read_content. Nothing here needs more,
// and the guard below makes sure nothing here can quietly start needing more.

const API_VERSION = '2025-10';

export function shopifyConfig(){
  const raw = (process.env.SHOPIFY_STORE_DOMAIN || '').trim();
  // Accept "shop.myshopify.com", "https://shop.myshopify.com", or a trailing slash.
  const domain = raw.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  const token = (process.env.SHOPIFY_ADMIN_TOKEN || '').trim();
  return { domain, token, configured: !!(domain && token), apiVersion: API_VERSION };
}

/**
 * One GraphQL call against the Admin API.
 *
 * The mutation guard is a hard backstop, not a comment: this app grades and rewrites
 * copy, and must never be the thing that changed a live store. If write-back is ever
 * wanted it is a deliberate, separate feature — write_themes, diff-and-confirm,
 * backup-first — not a loosened check here.
 */
export async function adminGraphQL(query, variables){
  const { domain, token, configured } = shopifyConfig();
  if (!configured){
    throw new Error('Shopify is not configured on the server — set SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_TOKEN.');
  }
  if (/\bmutation\b/i.test(query)){
    throw new Error('Refused: this client is read-only and rejects any mutation.');
  }

  const res = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables: variables || {} })
  });

  let data = {};
  try { data = await res.json(); } catch { /* handled below */ }

  if (res.status === 401 || res.status === 403){
    throw new Error('Shopify rejected the token (401/403). Check SHOPIFY_ADMIN_TOKEN and that the app has read_themes + read_content.');
  }
  if (res.status === 404){
    throw new Error(`Shopify returned 404 for ${domain} — check SHOPIFY_STORE_DOMAIN (it should be the *.myshopify.com admin domain).`);
  }
  if (!res.ok) throw new Error(`Shopify HTTP ${res.status}`);
  if (data.errors && data.errors.length){
    const throttled = data.errors.some(e => /throttl/i.test(e.message || ''));
    throw new Error((throttled ? 'Shopify throttled the request — try again in a moment. ' : '') +
      data.errors.map(e => e.message).join('; '));
  }
  if (!data.data) throw new Error('Shopify returned no data.');
  return data.data;
}

/* ---------- themes ---------- */

// Get the published theme by ROLE, never by paging the theme list. Stores accumulate
// themes — 25+ is normal — so `themes(first: 25)` reliably misses the live one. This bit
// us once already; it is the reason the role filter is not optional.
export async function mainTheme(){
  const d = await adminGraphQL(`
    query MainTheme {
      themes(first: 1, roles: [MAIN]) { nodes { id name role updatedAt } }
    }`);
  const theme = d.themes?.nodes?.[0];
  if (!theme) throw new Error('No published (MAIN) theme found on this store.');
  return theme;
}

// Every file in a theme, paginated. Filtering happens locally — the API has no
// filename-prefix filter, and the list is small enough that paging it all is cheaper
// than being clever.
export async function themeFiles(themeId){
  const out = [];
  let after = null;
  for (let page = 0; page < 40; page++){
    const d = await adminGraphQL(`
      query ThemeFiles($id: ID!, $after: String) {
        theme(id: $id) {
          files(first: 250, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes { filename size updatedAt }
          }
        }
      }`, { id: themeId, after });
    const files = d.theme?.files;
    if (!files) break;
    out.push(...(files.nodes || []));
    if (!files.pageInfo?.hasNextPage) break;
    after = files.pageInfo.endCursor;
  }
  return out;
}

// Literal page templates only — templates/page.json, templates/page.landing.json, …
// (deliberately not index/product/collection; see README).
export const PAGE_TEMPLATE_RE = /^templates\/page(\.[^/]+)?\.json$/;

export async function pageTemplateFiles(themeId){
  return themeFiles(themeId)
    .then(files => files.filter(f => PAGE_TEMPLATE_RE.test(f.filename || ''))
                        .sort((a, b) => a.filename.localeCompare(b.filename)));
}

/**
 * Read one theme file. The body is a union with three shapes and all three occur in
 * practice — text for small files, base64 when the content isn't clean UTF-8, and a URL
 * when it's large. Handling only the first shape looks fine until a template grows.
 */
export async function readThemeFile(themeId, filename){
  const d = await adminGraphQL(`
    query ThemeFile($id: ID!, $name: String!) {
      theme(id: $id) {
        files(first: 1, filenames: [$name]) {
          nodes {
            filename
            body {
              __typename
              ... on OnlineStoreThemeFileBodyText   { content }
              ... on OnlineStoreThemeFileBodyBase64 { contentBase64 }
              ... on OnlineStoreThemeFileBodyUrl    { url }
            }
          }
        }
      }
    }`, { id: themeId, name: filename });

  const node = d.theme?.files?.nodes?.[0];
  if (!node) throw new Error(`Theme file not found: ${filename}`);
  const body = node.body || {};

  switch (body.__typename){
    case 'OnlineStoreThemeFileBodyText':
      return body.content || '';
    case 'OnlineStoreThemeFileBodyBase64':
      return Buffer.from(body.contentBase64 || '', 'base64').toString('utf8');
    case 'OnlineStoreThemeFileBodyUrl': {
      const r = await fetch(body.url);
      if (!r.ok) throw new Error(`Couldn't fetch theme file body (HTTP ${r.status}).`);
      return await r.text();
    }
    default:
      throw new Error(`Unrecognised theme file body type: ${body.__typename || 'none'}`);
  }
}

/* ---------- Online Store pages (a separate source from themes) ---------- */

export async function listPages(){
  const out = [];
  let after = null;
  for (let page = 0; page < 20; page++){
    const d = await adminGraphQL(`
      query Pages($after: String) {
        pages(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { id title handle updatedAt }
        }
      }`, { after });
    const pages = d.pages;
    if (!pages) break;
    out.push(...(pages.nodes || []));
    if (!pages.pageInfo?.hasNextPage) break;
    after = pages.pageInfo.endCursor;
  }
  return out.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
}

export async function readPage(id){
  const d = await adminGraphQL(`
    query PageBody($id: ID!) { page(id: $id) { id title handle body } }`, { id });
  const p = d.page;
  if (!p) throw new Error('Page not found.');
  return p;
}
