import { checkAccess } from '../lib/auth.js';
import { readJson } from '../lib/http.js';
import { callAnthropic } from '../lib/anthropic.js';
import { COPY_SCHEMA } from '../lib/tools.js';

// Generation now writes a draft, critiques it, then writes the final copy, all inside
// one call with thinking on — same order of magnitude of work as /api/audit, so it gets
// the same wall-clock headroom.
export const maxDuration = 60;

export default async function handler(req, res){
  if (req.method !== 'POST'){ res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!checkAccess(req, res)) return;
  try {
    const { system, user, model } = await readJson(req);
    if (!system || !user){ res.status(400).json({ error: 'Missing system/user prompt.' }); return; }
    const result = await callAnthropic({ system, user, model, schema: COPY_SCHEMA, maxTokens: 16000 });
    res.status(200).json(result);
  } catch (e){
    res.status(502).json({ error: e.message });
  }
}
