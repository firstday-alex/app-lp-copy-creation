import { checkAccess } from '../lib/auth.js';
import { readJson } from '../lib/http.js';
import { callAnthropic } from '../lib/anthropic.js';
import { SLOTS_SCHEMA } from '../lib/tools.js';
import { checkLength } from '../lib/outline.js';

// The per-slot writer. Same arrangement as /api/generate: the browser assembles the
// prompt (it holds the synced sheet and the evidence), the server owns the output shape
// and the key.
//
// What the server adds on top of the proxy is the length re-check. The prompt states the
// per-kind word ranges, but stating a rule is not enforcing one — every returned variant
// is re-measured here so an over-length headline is visible in the UI even when the model
// ignored the instruction.
export const maxDuration = 60;

// One request writes at most this many slots. Beyond it the model starts trading quality
// per slot for coverage, and the response risks the token ceiling.
const MAX_SLOTS = 40;

export default async function handler(req, res){
  if (req.method !== 'POST'){ res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!checkAccess(req, res)) return;
  try {
    const { system, user, model, slots, variants } = await readJson(req);
    if (!system || !user){ res.status(400).json({ error: 'Missing system/user prompt.' }); return; }

    const asked = Array.isArray(slots) ? slots : [];
    if (!asked.length){ res.status(400).json({ error: 'No slots selected.' }); return; }
    if (asked.length > MAX_SLOTS){
      res.status(400).json({ error: `${asked.length} slots is too many for one pass — ${MAX_SLOTS} max. Select fewer, or run a section at a time.` });
      return;
    }
    if (asked.some(s => !s || !s.id || !s.kind)){
      res.status(400).json({ error: 'Every slot needs an id and a kind.' }); return;
    }
    const n = Math.min(5, Math.max(1, parseInt(variants, 10) || 3));

    const result = await callAnthropic({ system, user, model, schema: SLOTS_SCHEMA, maxTokens: 16000 });

    // Re-measure everything that came back, and say plainly what is missing.
    const kindById = {};
    asked.forEach(s => { kindById[s.id] = s.kind; });
    const returned = new Set();
    const warnings = [];

    (result.slots || []).forEach(slot => {
      returned.add(slot.id);
      const kind = kindById[slot.id] || slot.kind;
      slot.kind = kind;
      if (!kindById[slot.id]) warnings.push(`Returned a slot that wasn't requested: ${slot.id}`);
      if (Array.isArray(slot.variants) && slot.variants.length > n){
        slot.variants = slot.variants.slice(0, n);
      }
      (slot.variants || []).forEach((v, i) => {
        v.length = checkLength(kind, v.text || '');
        if (!v.length.ok) warnings.push(`${slot.id} option ${i + 1}: ${v.length.why}`);
        // The prompt asks for gaps as inline [VERIFY: …]; keep the two representations
        // consistent so the UI only has to look in one place.
        const inline = (v.text || '').match(/\[VERIFY:[^\]]*\]/gi) || [];
        v.verify = Array.from(new Set([...(v.verify || []), ...inline.map(s => s.replace(/^\[VERIFY:\s*|\]$/gi, '').trim())])).filter(Boolean);
      });
    });

    asked.forEach(s => { if (!returned.has(s.id)) warnings.push(`No copy came back for slot ${s.id}.`); });

    res.status(200).json({ ...result, warnings, requested: asked.length, variantsAsked: n });
  } catch (e){
    res.status(502).json({ error: e.message });
  }
}
