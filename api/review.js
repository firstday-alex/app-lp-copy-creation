import { checkAccess } from '../lib/auth.js';
import { readJson } from '../lib/http.js';
import { callAnthropic } from '../lib/anthropic.js';
import { REVIEW_SCHEMA } from '../lib/tools.js';

// Thinking is on now, so review needs the same wall-clock headroom as the other routes.
export const maxDuration = 60;

export default async function handler(req, res){
  if (req.method !== 'POST'){ res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!checkAccess(req, res)) return;
  try {
    const { system, user, model } = await readJson(req);
    if (!system || !user){ res.status(400).json({ error: 'Missing system/user prompt.' }); return; }
    const result = await callAnthropic({ system, user, model, schema: REVIEW_SCHEMA, maxTokens: 16000 });
    res.status(200).json(result);
  } catch (e){
    res.status(502).json({ error: e.message });
  }
}
