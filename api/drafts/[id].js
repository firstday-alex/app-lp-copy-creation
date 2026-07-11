import { checkAccess } from '../../lib/auth.js';
import { readJson } from '../../lib/http.js';
import { ensureSchema, sql, getFullDraft } from '../../lib/db.js';

export default async function handler(req, res){
  if (!checkAccess(req, res)) return;
  const id = req.query.id;
  try {
    await ensureSchema();

    if (req.method === 'GET'){
      const d = await getFullDraft(id);
      if (!d){ res.status(404).json({ error: 'Draft not found' }); return; }
      res.status(200).json(d);
      return;
    }

    if (req.method === 'PATCH'){
      // Only the human-review columns can change. The client sends the full
      // human-state for the line each time (accepted + reviewerNotes + reviewedBy).
      const body = await readJson(req);
      const idx = body.idx;
      if (idx == null){ res.status(400).json({ error: 'Missing line idx' }); return; }
      const accepted = body.accepted === true;
      const reviewerNotes = body.reviewerNotes ?? '';
      const reviewedBy = body.reviewedBy || '';
      const r = await sql`
        update draft_lines
           set accepted = ${accepted}, reviewer_notes = ${reviewerNotes},
               reviewed_by = ${reviewedBy}, reviewed_at = now()
         where draft_id = ${id} and idx = ${idx}`;
      if (r.rowCount === 0){ res.status(404).json({ error: 'Line not found' }); return; }
      await sql`update drafts set updated_at = now() where id = ${id}`;
      res.status(200).json({ ok: true });
      return;
    }

    if (req.method === 'DELETE'){
      await sql`delete from drafts where id = ${id}`;   // cascades to draft_lines
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e){
    res.status(500).json({ error: e.message });
  }
}
