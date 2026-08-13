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
// Simple mode returns three short strings; a page returns the whole composition plus every
// scoring layer. Sizing them the same would just pay for headroom nothing uses.
const MAX_TOKENS = { page: 16000, simple: 6000 };

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
