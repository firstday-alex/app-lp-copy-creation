import { checkAccess } from '../lib/auth.js';
import { readJson } from '../lib/http.js';
import { callAnthropic } from '../lib/anthropic.js';
import { COPY_SCHEMA, SIMPLE_SCHEMA } from '../lib/tools.js';

// Generation writes a draft, critiques it, then writes the final copy, all inside one call
// with thinking on — same order of magnitude of work as /api/audit, so it gets the same
// wall-clock headroom.
//
// `kind` selects the output shape: a whole page (the default) or Simple mode's
// header/subheader/body. Both live here rather than in separate routes because a Vercel
// Hobby deployment caps at 12 serverless functions and this app is at 11 — same reason
// /api/outline puts its reads behind an `op`.
export const maxDuration = 60;

const SCHEMAS = { page: COPY_SCHEMA, simple: SIMPLE_SCHEMA };
// Both get the same 16k ceiling. Simple mode's *copy* is three short strings, but the
// response around it is not: goal_read, a full draft, the self-critique, goal_fit, a
// copy_checks row per rule — and max_tokens covers thinking as well as the answer, so an
// adaptive-thinking model can spend thousands of tokens before the first field is written.
// A smaller cap here only bought truncation. The headroom is free: unused tokens aren't
// generated, and the binding limit is the 60s function ceiling, not the token count.
const MAX_TOKENS = { page: 16000, simple: 16000 };

export default async function handler(req, res){
  if (req.method !== 'POST'){ res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!checkAccess(req, res)) return;
  try {
    const { system, user, model, kind } = await readJson(req);
    if (!system || !user){ res.status(400).json({ error: 'Missing system/user prompt.' }); return; }
    const which = kind || 'page';
    const schema = SCHEMAS[which];
    if (!schema){
      res.status(400).json({ error: `Unknown kind "${which}". Expected ${Object.keys(SCHEMAS).join(' or ')}.` });
      return;
    }
    const result = await callAnthropic({ system, user, model, schema, maxTokens: MAX_TOKENS[which] });

    if (which === 'simple'){
      // The prompt asks for gaps as inline [VERIFY: …]; keep the two representations in
      // step so the UI only has to look in one place. Same treatment as /api/slots.
      const parts = result.copy || {};
      const inline = Object.values(parts).join(' ').match(/\[VERIFY:[^\]]*\]/gi) || [];
      result.verify = Array.from(new Set([
        ...(result.verify || []),
        ...inline.map(s => s.replace(/^\[VERIFY:\s*|\]$/gi, '').trim())
      ])).filter(Boolean);
    }
    res.status(200).json(result);
  } catch (e){
    res.status(502).json({ error: e.message });
  }
}
