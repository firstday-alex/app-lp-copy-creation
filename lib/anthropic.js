// Server-side Anthropic call. The key stays in ANTHROPIC_API_KEY and never reaches the browser.
// `images` is an optional [{media_type, data}] of base64 images (module mode sends
// the first-version screenshot). Image blocks go BEFORE the text block — the model
// reads the picture first, then the task written about it.
export async function callAnthropic({ system, user, model, tool, toolName, maxTokens, images }){
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not configured on the server.');

  const content = (images || []).map(img => ({
    type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data }
  }));
  content.push({ type: 'text', text: user });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: model || 'claude-sonnet-5',
      max_tokens: maxTokens || 8000,
      system,
      thinking: { type: 'disabled' },              // forced tool_choice is incompatible with adaptive thinking
      tools: [tool],
      tool_choice: { type: 'tool', name: toolName },
      messages: [{ role: 'user', content }]
    })
  });

  const data = await res.json();
  if (!res.ok){
    const t = data.error?.type ? `${data.error.type}: ` : '';
    throw new Error(`Anthropic HTTP ${res.status} — ${t}${data.error?.message || 'unknown error'}`);
  }
  // If the model ran out of room mid-structure, the forced tool call comes back
  // truncated — surface that plainly instead of rendering a half-empty result.
  if (data.stop_reason === 'max_tokens'){
    throw new Error('The response hit the token limit before finishing — the page is likely too long to audit in one pass. Try auditing a section at a time.');
  }
  const toolUse = (data.content || []).find(c => c.type === 'tool_use');
  if (!toolUse) throw new Error('Model did not return structured output.');
  return toolUse.input;
}
