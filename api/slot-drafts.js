import { checkAccess } from '../lib/auth.js';
import { readJson } from '../lib/http.js';
import { ensureSchema, getSlotDrafts, putSlotDraft, deleteSlotDraft } from '../lib/db.js';

// The copy written into individual slots, shared across the team like review drafts are.
// Keyed by (source_ref, node_id) and independent of bookmarks — see lib/db.js.
export default async function handler(req, res){
  if (!checkAccess(req, res)) return;
  try {
    await ensureSchema();

    if (req.method === 'GET'){
      const sourceRef = (req.query.sourceRef || '').toString();
      if (!sourceRef){ res.status(400).json({ error: 'Missing sourceRef.' }); return; }
      res.status(200).json(await getSlotDrafts(sourceRef));
      return;
    }

    if (req.method === 'PUT'){
      const { sourceRef, nodeId, value, status, sourceAtEdit, updatedBy } = await readJson(req);
      if (!sourceRef || !nodeId){ res.status(400).json({ error: 'Missing sourceRef or nodeId.' }); return; }
      // An emptied slot means "no draft here", not "a draft that is blank" — otherwise
      // clearing a box would leave a row that reads as written-and-empty on export.
      if (!String(value || '').trim()){
        await deleteSlotDraft(sourceRef, nodeId);
        res.status(200).json({ ok: true, cleared: true });
        return;
      }
      await putSlotDraft({ sourceRef, nodeId, value, status, sourceAtEdit, updatedBy });
      res.status(200).json({ ok: true });
      return;
    }

    if (req.method === 'DELETE'){
      const sourceRef = (req.query.sourceRef || '').toString();
      const nodeId = (req.query.nodeId || '').toString();
      if (!sourceRef || !nodeId){ res.status(400).json({ error: 'Missing sourceRef or nodeId.' }); return; }
      await deleteSlotDraft(sourceRef, nodeId);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e){
    res.status(500).json({ error: e.message });
  }
}
