// Server-side Anthropic call. The key stays in ANTHROPIC_API_KEY and never reaches the browser.
// `images` is an optional [{media_type, data}] of base64 images (module mode sends
// the first-version screenshot). Image blocks go BEFORE the text block — the model
// reads the picture first, then the task written about it.
//
// Output shape comes from structured outputs (output_config.format), not a forced tool
// call. Structured outputs are documented to work alongside extended thinking, so the
// model can think before it answers, and they validate the schema more strictly than a
// tool definition does.

// Adaptive thinking is available on the Fable/Opus/Sonnet 5 and 4.6+ lines. Haiku 4.5
// only accepts the older fixed-budget form, so we leave `thinking` unset for it — Haiku
// then answers without thinking, which is the point of picking the fast option.
const ADAPTIVE_THINKING = /^claude-(fable|opus|sonnet)-(5|4-[6-9])(-|$)/;

export async function callAnthropic({ system, user, model, schema, maxTokens, images }){
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not configured on the server.');

  const modelId = model || 'claude-sonnet-5';

  const content = (images || []).map(img => ({
    type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data }
  }));
  content.push({ type: 'text', text: user });

  const body = {
    model: modelId,
    max_tokens: maxTokens || 16000,
    system,
    output_config: { format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content }]
  };
  if (ADAPTIVE_THINKING.test(modelId)) body.thinking = { type: 'adaptive' };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  if (!res.ok){
    const t = data.error?.type ? `${data.error.type}: ` : '';
    throw new Error(`Anthropic HTTP ${res.status} — ${t}${data.error?.message || 'unknown error'}`);
  }
  // max_tokens now covers thinking as well as the answer, so a truncated response is
  // the likeliest failure. It comes back as unparseable JSON — say so plainly instead
  // of rendering a half-empty result.
  if (data.stop_reason === 'max_tokens'){
    throw new Error(`The response hit the ${body.max_tokens.toLocaleString()}-token limit before finishing. If you asked for a lot at once, try a smaller section; otherwise the ceiling for this call is too low for the shape of answer it asks for.`);
  }
  if (data.stop_reason === 'refusal'){
    throw new Error('The model declined this request. Check the brief for anything the safety classifiers would read as off-limits.');
  }

  const text = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  if (!text.trim()) throw new Error('Model did not return structured output.');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Model returned output that was not valid JSON.');
  }
}
