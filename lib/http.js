// Read a JSON body regardless of whether the platform pre-parsed it.
export async function readJson(req){
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string'){ try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}
