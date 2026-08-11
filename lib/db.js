import { sql } from '@vercel/postgres';

// The review drafts live in Postgres so the whole team shares them.
// Two tables: `drafts` (one per reviewed page) and `draft_lines` (one per line of copy).
// The agent columns are written once at creation; only the human-review columns
// (accepted / reviewer_notes / reviewed_by) are ever updated afterwards.
//
// Slot mode adds two more: `bookmarks` (a saved page/template, with a snapshot of its
// outline so it stays readable when the store is unreachable) and `slot_drafts` (the copy
// written into individual slots). Slot drafts are deliberately NOT children of bookmarks —
// a writer can draft into a page without saving it, and bookmarking later must not lose
// or duplicate that work.

let schemaReady = false;
export async function ensureSchema(){
  if (schemaReady) return;
  await sql`
    create table if not exists drafts (
      id          text primary key,
      created_at  timestamptz not null default now(),
      updated_at  timestamptz not null default now(),
      title       text,
      product     text,
      problems    jsonb not null default '[]'::jsonb,
      template    text,
      channel     text,
      model       text,
      copy        text,
      holistic    jsonb not null default '{}'::jsonb,
      compliance  jsonb not null default '{"pass":false,"blockers":[]}'::jsonb
    )`;
  await sql`
    create table if not exists draft_lines (
      draft_id          text not null references drafts(id) on delete cascade,
      idx               int  not null,
      line              text,
      type              text,
      score             int,
      flags             jsonb not null default '[]'::jsonb,
      notes             text,
      suggested_rewrite text,
      grounded          boolean not null default true,
      fact_sheet_id     text,
      accepted          boolean not null default false,   -- human review layer
      reviewer_notes    text not null default '',         -- human review layer
      reviewed_by       text not null default '',         -- human review layer
      reviewed_at       timestamptz,
      primary key (draft_id, idx)
    )`;
  await sql`
    create table if not exists bookmarks (
      id          text primary key,
      created_at  timestamptz not null default now(),
      updated_at  timestamptz not null default now(),
      source_kind text not null,                          -- 'theme_template' | 'page'
      source_ref  text not null,                          -- theme filename, or the page's gid
      label       text not null default '',
      theme_name  text,
      note        text not null default '',
      outline     jsonb not null default '[]'::jsonb,      -- snapshot, for quick reference
      slot_count  int  not null default 0,
      empty_count int  not null default 0,
      created_by  text not null default '',
      unique (source_kind, source_ref)
    )`;
  await sql`
    create table if not exists slot_drafts (
      source_ref     text not null,                        -- the template/page a slot belongs to
      node_id        text not null,                        -- OutlineNode.id
      value          text not null default '',
      status         text not null default 'ai',           -- 'ai' | 'edited'
      source_at_edit text,                                 -- store copy as it was when this was written
      updated_at     timestamptz not null default now(),
      updated_by     text not null default '',
      primary key (source_ref, node_id)
    )`;
  schemaReady = true;
}

// Fetch one draft in the exact shape the frontend renders.
export async function getFullDraft(id){
  const d = (await sql`select * from drafts where id=${id}`).rows[0];
  if (!d) return null;
  const lines = (await sql`select * from draft_lines where draft_id=${id} order by idx`).rows;
  return {
    id: d.id,
    createdAt: d.created_at,
    model: d.model,
    copy: d.copy,
    brief: { title: d.title, product: d.product, problems: d.problems || [], template: d.template, channel: d.channel },
    review: { holistic: d.holistic || {}, overall_compliance: d.compliance || { pass:false, blockers:[] } },
    rows: lines.map(l => ({
      line: l.line, type: l.type, score: l.score, flags: l.flags || [], notes: l.notes,
      suggested_rewrite: l.suggested_rewrite, grounded: l.grounded, fact_sheet_id: l.fact_sheet_id,
      accepted: l.accepted, reviewerNotes: l.reviewer_notes, reviewedBy: l.reviewed_by, reviewedAt: l.reviewed_at
    }))
  };
}

/* ---------- saved templates (bookmarks) ---------- */

const bookmarkRow = b => ({
  id: b.id,
  createdAt: b.created_at,
  updatedAt: b.updated_at,
  source: { kind: b.source_kind, ref: b.source_ref, label: b.label, themeName: b.theme_name },
  note: b.note || '',
  counts: { total: b.slot_count, empty: b.empty_count },
  createdBy: b.created_by || '',
  draftCount: b.draft_count == null ? undefined : b.draft_count
});

// Newest first, with a count of how much copy has actually been written into each —
// that number is what makes the list worth scanning.
export async function listBookmarks(){
  const { rows } = await sql`
    select b.*, (select count(*)::int from slot_drafts s
                  where s.source_ref = b.source_ref and s.value <> '') as draft_count
      from bookmarks b
     order by b.updated_at desc`;
  return rows.map(bookmarkRow);
}

// Bookmarking the same source twice updates it rather than making a second row: the
// snapshot refreshes and the note survives unless a new one is given.
export async function upsertBookmark({ id, source, note, outline, counts, createdBy }){
  const s = source || {};
  const { rows } = await sql`
    insert into bookmarks (id, source_kind, source_ref, label, theme_name, note, outline, slot_count, empty_count, created_by)
    values (${id}, ${s.kind || 'theme_template'}, ${s.ref || ''}, ${s.label || s.ref || ''},
            ${s.themeName || null}, ${note || ''}, ${JSON.stringify(outline || [])}::jsonb,
            ${(counts && counts.total) || 0}, ${(counts && counts.empty) || 0}, ${createdBy || ''})
    on conflict (source_kind, source_ref) do update
       set label       = excluded.label,
           theme_name  = excluded.theme_name,
           note        = case when excluded.note <> '' then excluded.note else bookmarks.note end,
           outline     = excluded.outline,
           slot_count  = excluded.slot_count,
           empty_count = excluded.empty_count,
           updated_at  = now()
    returning *`;
  return bookmarkRow(rows[0]);
}

export async function getBookmark(id){
  const b = (await sql`select * from bookmarks where id = ${id}`).rows[0];
  if (!b) return null;
  return { ...bookmarkRow(b), outline: b.outline || [], drafts: await getSlotDrafts(b.source_ref) };
}

/* ---------- slot drafts ---------- */

// Keyed by (source_ref, node_id). The store is implicit — one deployment reads one store —
// so source_ref is the "template" half of the (store, template, node id) key.
export async function getSlotDrafts(sourceRef){
  const { rows } = await sql`
    select node_id, value, status, source_at_edit, updated_at, updated_by
      from slot_drafts where source_ref = ${sourceRef}`;
  const out = {};
  rows.forEach(r => { out[r.node_id] = {
    value: r.value, status: r.status,
    sourceAtEdit: r.source_at_edit, updatedAt: r.updated_at, updatedBy: r.updated_by
  }; });
  return out;
}

// `sourceAtEdit` snapshots the store copy at the moment of the edit. That is what lets the
// UI later say "the store changed under this draft" instead of silently clobbering one or
// the other.
export async function putSlotDraft({ sourceRef, nodeId, value, status, sourceAtEdit, updatedBy }){
  await sql`
    insert into slot_drafts (source_ref, node_id, value, status, source_at_edit, updated_by)
    values (${sourceRef}, ${nodeId}, ${value || ''}, ${status === 'edited' ? 'edited' : 'ai'},
            ${sourceAtEdit == null ? null : sourceAtEdit}, ${updatedBy || ''})
    on conflict (source_ref, node_id) do update
       set value = excluded.value, status = excluded.status,
           source_at_edit = excluded.source_at_edit,
           updated_by = excluded.updated_by, updated_at = now()`;
}

export async function deleteSlotDraft(sourceRef, nodeId){
  await sql`delete from slot_drafts where source_ref = ${sourceRef} and node_id = ${nodeId}`;
}

export { sql };
