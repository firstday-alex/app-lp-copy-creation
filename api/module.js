import { checkAccess } from '../lib/auth.js';
import { readJson } from '../lib/http.js';
import { callAnthropic } from '../lib/anthropic.js';
import { MODULE_SCHEMA } from '../lib/tools.js';

// Module mode reads an image, grades it, rewrites the module, then re-checks the
// rewrite — same shape of work as /api/audit, so it gets the same headroom.
export const maxDuration = 60;

const MAX_IMAGES = 4;
const OK_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
// Vercel caps the request body at 4.5MB; base64 is ~4/3 of the raw bytes.
const MAX_B64_TOTAL = 3_400_000;

export default async function handler(req, res){
  if (req.method !== 'POST'){ res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!checkAccess(req, res)) return;
  try {
    const { system, user, model, images } = await readJson(req);
    if (!system || !user){ res.status(400).json({ error: 'Missing system/user prompt.' }); return; }

    const imgs = Array.isArray(images) ? images : [];
    if (!imgs.length){ res.status(400).json({ error: 'Module mode needs at least one image of the first version.' }); return; }
    if (imgs.length > MAX_IMAGES){ res.status(400).json({ error: `Too many images — ${MAX_IMAGES} max.` }); return; }

    let total = 0;
    for (const img of imgs){
      if (!img || typeof img.data !== 'string' || !OK_TYPES.has(img.media_type)){
        res.status(400).json({ error: 'Each image needs base64 data and a PNG/JPEG/GIF/WebP media type.' }); return;
      }
      total += img.data.length;
    }
    if (total > MAX_B64_TOTAL){
      res.status(413).json({ error: 'The images are too large to send in one request. Crop to just the module, or upload fewer.' }); return;
    }

    const result = await callAnthropic({
      system, user, model, images: imgs,
      schema: MODULE_SCHEMA, maxTokens: 16000
    });
    res.status(200).json(result);
  } catch (e){
    res.status(502).json({ error: e.message });
  }
}
