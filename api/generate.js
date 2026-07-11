import { checkAccess } from '../lib/auth.js';
import { readJson } from '../lib/http.js';
import { callAnthropic } from '../lib/anthropic.js';
import { EMIT_COPY } from '../lib/tools.js';

export default async function handler(req, res){
  if (req.method !== 'POST'){ res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!checkAccess(req, res)) return;
  try {
    const { system, user, model } = await readJson(req);
    if (!system || !user){ res.status(400).json({ error: 'Missing system/user prompt.' }); return; }
    const result = await callAnthropic({ system, user, model, tool: EMIT_COPY, toolName: 'emit_copy' });
    res.status(200).json(result);
  } catch (e){
    res.status(502).json({ error: e.message });
  }
}
