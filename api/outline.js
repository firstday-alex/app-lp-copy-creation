import { checkAccess } from '../lib/auth.js';
import { shopifyConfig, mainTheme, pageTemplateFiles, readThemeFile, listPages, readPage } from '../lib/shopify.js';
import { readJson } from '../lib/http.js';
import { parseThemeTemplate, parseHtmlOutline, countSlots, toMarkdown, toExportJson, KIND_RULES } from '../lib/outline.js';
import { selftestMarkdown } from '../lib/selftest.js';

// Reading a source and turning it into an outline. One route with an `op`, because the
// parsers live server-side (like the schemas in lib/tools.js) — the browser sends a
// selector and renders a tree, and there is exactly one implementation of the heuristics.
export const maxDuration = 30;

export default async function handler(req, res){
  const op = (req.query.op || '').toString();

  // The selftest needs no store, no key and no database, so it answers before anything
  // else can fail. `?op=selftest` is the quickest way to tell whether a parser change broke.
  if (op === 'selftest'){
    if (!checkAccess(req, res)) return;
    try {
      const r = selftestMarkdown();
      res.setHeader('content-type', 'text/markdown; charset=utf-8');
      res.status(r.pass ? 200 : 500).send(r.markdown);
    } catch (e){
      // A throw here means the harness itself broke, which is worth saying plainly
      // rather than reporting as a parser failure.
      res.status(500).json({ error: `Selftest harness failed: ${e.message}` });
    }
    return;
  }

  // Export is the one op that writes nothing and reads nothing external — it renders an
  // outline the client already holds. It lives here so there is a single implementation
  // of what an export looks like, rather than one on each side of the wire.
  if (op === 'export'){
    if (req.method !== 'POST'){ res.status(405).json({ error: 'Export is a POST.' }); return; }
    if (!checkAccess(req, res)) return;
    try {
      const { outline, drafts, meta, format } = await readJson(req);
      const tree = Array.isArray(outline) ? outline : [];
      if (format === 'json'){
        res.status(200).json(toExportJson(tree, drafts, meta));
      } else {
        res.setHeader('content-type', 'text/markdown; charset=utf-8');
        res.status(200).send(toMarkdown(tree, drafts, (meta && meta.label) || ''));
      }
    } catch (e){
      res.status(400).json({ error: `Couldn't render the export — ${e.message}` });
    }
    return;
  }

  if (req.method !== 'GET'){ res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!checkAccess(req, res)) return;

  try {
    const cfg = shopifyConfig();

    if (op === 'status'){
      // Never echo the token — only whether it is present. The length rules ride along so
      // the browser can badge word counts without keeping its own copy of them to drift.
      res.status(200).json({
        configured: cfg.configured, domain: cfg.domain || '', apiVersion: cfg.apiVersion,
        rules: KIND_RULES
      });
      return;
    }

    if (!cfg.configured){
      res.status(503).json({ error: 'Shopify is not configured on the server — set SHOPIFY_STORE_DOMAIN and SHOPIFY_ADMIN_TOKEN, then redeploy.' });
      return;
    }

    if (op === 'sources'){
      // Everything the picker needs, in one round trip.
      const theme = await mainTheme();
      const [files, pages] = await Promise.all([
        pageTemplateFiles(theme.id),
        listPages().catch(e => ({ __err: e.message }))
      ]);
      res.status(200).json({
        theme: { id: theme.id, name: theme.name, role: theme.role },
        templates: files.map(f => ({ filename: f.filename, size: f.size, updatedAt: f.updatedAt })),
        pages: Array.isArray(pages) ? pages : [],
        pagesError: Array.isArray(pages) ? null : pages.__err
      });
      return;
    }

    if (op === 'template'){
      const filename = (req.query.filename || '').toString();
      if (!filename){ res.status(400).json({ error: 'Missing filename.' }); return; }
      const theme = await mainTheme();
      const raw = await readThemeFile(theme.id, filename);
      let outline;
      try {
        outline = parseThemeTemplate(raw, filename);
      } catch (e){
        res.status(422).json({ error: `${filename} isn't valid JSON — ${e.message}` }); return;
      }
      res.status(200).json({
        source: { kind: 'theme_template', ref: filename, label: filename.replace(/^templates\//, ''),
                  themeName: theme.name, themeId: theme.id },
        outline, counts: countSlots(outline)
      });
      return;
    }

    if (op === 'page'){
      const id = (req.query.id || '').toString();
      if (!id){ res.status(400).json({ error: 'Missing page id.' }); return; }
      const page = await readPage(id);
      const outline = parseHtmlOutline(page.body || '', { idPrefix: 'page.body', path: 'page.body' });
      res.status(200).json({
        source: { kind: 'page', ref: page.id, label: page.title || page.handle, handle: page.handle },
        outline, counts: countSlots(outline)
      });
      return;
    }

    res.status(400).json({ error: `Unknown op "${op}". Expected status, sources, template, page or selftest.` });
  } catch (e){
    res.status(502).json({ error: e.message });
  }
}
