import { checkAccess } from '../../lib/auth.js';
import { readJson } from '../../lib/http.js';
import { ensureSchema, listBookmarks, upsertBookmark } from '../../lib/db.js';
import { countSlots } from '../../lib/outline.js';

// Saved templates. A bookmark is a page or theme template someone wants to come back to,
// stored with a snapshot of its outline so the saved list stays readable — and stays
// comparable against the live store — without a Shopify round trip per row.
function newId(){ return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

export default async function handler(req, res){
  if (!checkAccess(req, res)) return;
  try {
    await ensureSchema();

    if (req.method === 'GET'){
      res.status(200).json(await listBookmarks());
      return;
    }

    if (req.method === 'POST'){
      const { source, outline, note, createdBy } = await readJson(req);
      if (!source || !source.ref){ res.status(400).json({ error: 'A bookmark needs source.ref.' }); return; }
      if (!['theme_template', 'page'].includes(source.kind || '')){
        res.status(400).json({ error: 'source.kind must be "theme_template" or "page".' }); return;
      }
      const tree = Array.isArray(outline) ? outline : [];
      // Count server-side rather than trusting the client's numbers — the saved list is
      // read far more often than it is written, and a wrong count is worse than no count.
      const saved = await upsertBookmark({
        id: newId(), source, note, outline: tree, counts: countSlots(tree), createdBy
      });
      res.status(200).json(saved);
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e){
    res.status(500).json({ error: e.message });
  }
}
