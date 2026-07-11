import { checkAccess } from '../../lib/auth.js';
import { readJson } from '../../lib/http.js';
import { ensureSchema, sql, getFullDraft } from '../../lib/db.js';

function newId(){ return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

export default async function handler(req, res){
  if (!checkAccess(req, res)) return;
  try {
    await ensureSchema();

    if (req.method === 'GET'){
      // list — lightweight summary rows, newest first
      const { rows } = await sql`
        select d.id, d.created_at, d.title, d.product, d.problems, d.model, d.holistic,
               count(l.*)::int as line_count,
               count(*) filter (where l.accepted)::int as accepted_count
          from drafts d
          left join draft_lines l on l.draft_id = d.id
         group by d.id
         order by d.created_at desc`;
      res.status(200).json(rows.map(r => ({
        id: r.id,
        createdAt: r.created_at,
        brief: { title: r.title, product: r.product, problems: r.problems || [] },
        model: r.model,
        holistic: r.holistic || {},
        lineCount: r.line_count,
        acceptedCount: r.accepted_count
      })));
      return;
    }

    if (req.method === 'POST'){
      // create — agent columns written once here
      const { brief = {}, copy = '', review = {}, model = '' } = await readJson(req);
      const id = newId();
      const holistic = review.holistic || {};
      const compliance = review.overall_compliance || { pass: false, blockers: [] };

      await sql`
        insert into drafts (id, title, product, problems, template, channel, model, copy, holistic, compliance)
        values (${id}, ${brief.title || null}, ${brief.product || null},
                ${JSON.stringify(brief.problems || [])}::jsonb,
                ${brief.template || null}, ${brief.channel || null}, ${model || null}, ${copy || null},
                ${JSON.stringify(holistic)}::jsonb, ${JSON.stringify(compliance)}::jsonb)`;

      const lines = review.lines || [];
      for (let i = 0; i < lines.length; i++){
        const l = lines[i];
        await sql`
          insert into draft_lines (draft_id, idx, line, type, score, flags, notes, suggested_rewrite, grounded, fact_sheet_id)
          values (${id}, ${i}, ${l.line || ''}, ${l.type || ''}, ${l.score == null ? null : l.score},
                  ${JSON.stringify(l.rubric_flags || [])}::jsonb, ${l.notes || ''}, ${l.suggested_rewrite || ''},
                  ${l.grounded !== false}, ${l.fact_sheet_id || ''})`;
      }
      res.status(201).json(await getFullDraft(id));
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e){
    res.status(500).json({ error: e.message });
  }
}
