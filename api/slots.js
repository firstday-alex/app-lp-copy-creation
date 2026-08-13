import { checkAccess } from '../lib/auth.js';
import { readJson } from '../lib/http.js';
import { callAnthropic } from '../lib/anthropic.js';
import { SLOTS_SCHEMA } from '../lib/tools.js';
import { checkLength, SLOT_UNIT_BUDGET, SLOT_MAX_PER_PASS } from '../lib/outline.js';

// The per-slot writer. Same arrangement as /api/generate: the browser assembles the
// prompt (it holds the synced sheet and the evidence), the server owns the output shape
// and the key.
//
// What the server adds on top of the proxy is the length re-check. The prompt states the
// per-kind word ranges, but stating a rule is not enforcing one — every returned variant
// is re-measured here so an over-length headline is visible in the UI even when the model
// ignored the instruction.
export const maxDuration = 60;

const MAX_TOKENS = 16000;

// The response is slots × variants × rules, so the limit has to be that product, not a
// round number of slots. A 40-slot × 3-variant request needs roughly twice MAX_TOKENS: it
// generates for the entire time budget and then truncates — and generating 16k tokens with
// thinking on often exceeds maxDuration first, which surfaces as a dead request rather than
// an error. So the cap is a budget, and the client batches to fit inside it.
//
// ~260 output tokens per variant with justifications only on failures, plus the draft and
// critique passes. The number itself lives in lib/outline.js so the client, this route and
// op=status can't drift apart.
const MAX_UNITS = SLOT_UNIT_BUDGET;
const unitsFor = (slots, variants) => slots * Math.max(1, variants);

export default async function handler(req, res){
  if (req.method !== 'POST'){ res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!checkAccess(req, res)) return;
  try {
    const { system, user, model, slots, variants } = await readJson(req);
    if (!system || !user){ res.status(400).json({ error: 'Missing system/user prompt.' }); return; }

    const asked = Array.isArray(slots) ? slots : [];
    if (!asked.length){ res.status(400).json({ error: 'No slots selected.' }); return; }
    if (asked.some(s => !s || !s.id || !s.kind)){
      res.status(400).json({ error: 'Every slot needs an id and a kind.' }); return;
    }
    const n = Math.min(5, Math.max(1, parseInt(variants, 10) || 3));

    if (asked.length > SLOT_MAX_PER_PASS){
      res.status(400).json({
        error: `${asked.length} slots in one pass is more than the model attends to individually — ${SLOT_MAX_PER_PASS} max, whatever the option count. Batch it.`,
        maxSlotsPerPass: SLOT_MAX_PER_PASS
      });
      return;
    }
    const units = unitsFor(asked.length, n);
    if (units > MAX_UNITS){
      res.status(400).json({
        error: `${asked.length} slots × ${n} options is ${units} lines of copy — over the ${MAX_UNITS} a single pass can finish before hitting the token ceiling. `
             + `At ${n} option${n > 1 ? 's' : ''} the limit is ${Math.max(1, Math.floor(MAX_UNITS / n))} slots per request.`,
        maxSlotsForVariants: Math.max(1, Math.floor(MAX_UNITS / n))
      });
      return;
    }

    const result = await callAnthropic({ system, user, model, schema: SLOTS_SCHEMA, maxTokens: MAX_TOKENS });

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
