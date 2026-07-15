import { checkAccess } from '../lib/auth.js';
import { readJson } from '../lib/http.js';
import { callAnthropic } from '../lib/anthropic.js';
import { EMIT_AUDIT } from '../lib/tools.js';

// Audit grades an existing page AND rewrites it, so its output is large — give
// it a bigger token budget and more wall-clock than generate/review.
export const maxDuration = 60;

export default async function handler(req, res){
  if (req.method !== 'POST'){ res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!checkAccess(req, res)) return;
  try {
    const { system, user, model } = await readJson(req);
    if (!system || !user){ res.status(400).json({ error: 'Missing system/user prompt.' }); return; }
    const result = await callAnthropic({ system, user, model, tool: EMIT_AUDIT, toolName: 'emit_audit', maxTokens: 12000 });
    res.status(200).json(result);
  } catch (e){
    res.status(502).json({ error: e.message });
  }
}
