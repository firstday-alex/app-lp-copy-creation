import { sql } from '@vercel/postgres';

// The review drafts live in Postgres so the whole team shares them.
// Two tables: `drafts` (one per reviewed page) and `draft_lines` (one per line of copy).
// The agent columns are written once at creation; only the human-review columns
// (accepted / reviewer_notes / reviewed_by) are ever updated afterwards.

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

export { sql };
