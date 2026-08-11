import { checkAccess } from '../../lib/auth.js';
import { readJson } from '../../lib/http.js';
import { ensureSchema, sql, getBookmark } from '../../lib/db.js';

export default async function handler(req, res){
  if (!checkAccess(req, res)) return;
  const id = req.query.id;
  try {
    await ensureSchema();

    if (req.method === 'GET'){
      // The snapshot plus whatever has been drafted into it — everything the reference
      // view needs, without touching Shopify.
      const b = await getBookmark(id);
      if (!b){ res.status(404).json({ error: 'Bookmark not found' }); return; }
      res.status(200).json(b);
      return;
    }

    if (req.method === 'PATCH'){
      const body = await readJson(req);
      const label = body.label;
      const note = body.note;
      if (label == null && note == null){ res.status(400).json({ error: 'Nothing to update — send label and/or note.' }); return; }
      const r = await sql`
        update bookmarks
           set label = coalesce(${label ?? null}, label),
               note  = coalesce(${note ?? null}, note),
               updated_at = now()
         where id = ${id}`;
      if (r.rowCount === 0){ res.status(404).json({ error: 'Bookmark not found' }); return; }
      res.status(200).json(await getBookmark(id));
      return;
    }

    if (req.method === 'DELETE'){
      // Unbookmarking removes the shortcut, not the writing. Slot drafts survive by
      // default so re-bookmarking brings the work back; ?purgeDrafts=1 is the explicit
      // "throw the copy away too" path, and the UI confirms before sending it.
      const row = (await sql`select source_ref from bookmarks where id = ${id}`).rows[0];
      if (!row){ res.status(404).json({ error: 'Bookmark not found' }); return; }
      await sql`delete from bookmarks where id = ${id}`;
      let purged = 0;
      if (req.query.purgeDrafts === '1'){
        const d = await sql`delete from slot_drafts where source_ref = ${row.source_ref}`;
        purged = d.rowCount || 0;
      }
      const kept = (await sql`select count(*)::int as n from slot_drafts where source_ref = ${row.source_ref}`).rows[0].n;
      res.status(200).json({ ok: true, draftsPurged: purged, draftsKept: kept });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e){
    res.status(500).json({ error: e.message });
  }
}
