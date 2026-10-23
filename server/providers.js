'use strict';
// Integrações reais com provedores de IA (streaming). Nenhuma resposta é simulada.
const dns = require('dns').promises, net = require('net');

const PROVIDERS = {
  openai:     { label: 'OpenAI',                  base: 'https://api.openai.com/v1',            kind: 'openai',    keyUrl: 'platform.openai.com/api-keys', defaultModel: 'gpt-4o-mini' },
  anthropic:  { label: 'Anthropic',               base: 'https://api.anthropic.com/v1',         kind: 'anthropic', keyUrl: 'console.anthropic.com',        defaultModel: 'claude-sonnet-4-5' },
  gemini:     { label: 'Google Gemini',           base: 'https://generativelanguage.googleapis.com/v1beta', kind: 'gemini', keyUrl: 'aistudio.google.com/apikey', defaultModel: 'gemini-2.0-flash' },
  openrouter: { label: 'OpenRouter',              base: 'https://openrouter.ai/api/v1',         kind: 'openai',    keyUrl: 'openrouter.ai/keys',           defaultModel: 'openai/gpt-4o-mini' },
  custom:     { label: 'Compatível com OpenAI',   base: '',                                     kind: 'openai',    keyUrl: '',                             defaultModel: '', needsBase: true },
};

class AIError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status; } }

function privateHost(h) {
  return /^(localhost|.*\.local|.*\.internal)$/i.test(h) || (net.isIP(h) && /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1|fc|fd|fe80)/i.test(h));
}
// Evita que a URL personalizada seja usada para alcançar a rede interna do servidor.
async function checkBase(url) {
  let u; try { u = new URL(url); } catch { throw new AIError('config', 'URL base inválida.'); }
  if (!/^https?:$/.test(u.protocol)) throw new AIError('config', 'Use uma URL http(s).');
  if (process.env.AIS_ALLOW_PRIVATE_URLS === '1') return;
  if (privateHost(u.hostname)) throw new AIError('config', 'URLs de rede local estão bloqueadas neste servidor.');
  if (!net.isIP(u.hostname)) { try { for (const a of await dns.lookup(u.hostname, { all: true })) if (privateHost(a.address)) throw new AIError('config', 'Esse endereço aponta para a rede interna.'); } catch (e) { if (e instanceof AIError) throw e; } }
}

function classify(status, body) {
  const t = (typeof body === 'string' ? body : JSON.stringify(body || '')).toLowerCase();
  if (status === 401 || status === 403) return new AIError('auth', 'A chave de API foi recusada pelo provedor. Confira se ela está correta e ativa.', status);
  if (status === 402 || /insufficient_quota|insufficient.*(credit|balance)|billing|credit balance|exceeded your current quota/.test(t)) return new AIError('balance', 'Saldo ou cota insuficiente nessa conexão.', status);
  if (status === 429) return new AIError('rate', 'O provedor limitou as requisições (limite de uso por minuto/dia). Tente depois ou troque de IA.', status);
  if (status === 404) return new AIError('model', 'Modelo não encontrado nessa conta. Escolha outro modelo.', status);
  if (status === 400 && /model/.test(t)) return new AIError('model', 'O provedor recusou o modelo ou a solicitação. Escolha outro modelo.', status);
  if (status >= 500) return new AIError('unavailable', 'O provedor está indisponível no momento.', status);
  return new AIError('request', `O provedor recusou a solicitação (${status}).`, status);
}

async function http(url, opts, signal) {
  let r;
  try { r = await fetch(url, { ...opts, signal }); }
  catch (e) { if (e.name === 'AbortError') throw e; throw new AIError('network', 'Não foi possível conectar ao provedor. Verifique a internet ou a URL base.'); }
  if (!r.ok) { let b = ''; try { b = await r.text(); } catch {} throw classify(r.status, b); }
  return r;
}

async function* sse(res) {
  const dec = new TextDecoder(); let buf = '';
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i; while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
      const ev = buf.slice(0, i); buf = buf.slice(i).replace(/^\r?\n\r?\n/, '');
      const data = ev.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
      if (data && data !== '[DONE]') { try { yield JSON.parse(data); } catch {} }
    }
  }
}

// messages: [{role:'user'|'assistant', text, images:[{mime,b64}]}]
async function* stream(ai, key, system, messages, signal) {
  const P = PROVIDERS[ai.provider]; const base = (ai.base_url || P.base).replace(/\/$/, '');
  if (ai.provider === 'custom') await checkBase(base);
  const temp = ai.temperature ?? undefined;
  if (P.kind === 'openai') {
    const msgs = [...(system ? [{ role: 'system', content: system }] : []), ...messages.map(m => ({
      role: m.role, content: m.images?.length ? [{ type: 'text', text: m.text || ' ' }, ...m.images.map(i => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.b64}` } }))] : m.text }))];
    const res = await http(base + '/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify({ model: ai.model, messages: msgs, stream: true, stream_options: { include_usage: true }, ...(temp != null && { temperature: temp }) }) }, signal);
    for await (const j of sse(res)) {
      const d = j.choices?.[0]?.delta?.content; if (d) yield { text: d };
      if (j.usage) yield { usage: { in: j.usage.prompt_tokens || 0, out: j.usage.completion_tokens || 0 } };
    }
  } else if (P.kind === 'anthropic') {
    const msgs = messages.map(m => ({ role: m.role, content: m.images?.length ? [...m.images.map(i => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.b64 } })), { type: 'text', text: m.text || ' ' }] : (m.text || ' ') }));
    const res = await http(base + '/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: ai.model, max_tokens: 4096, stream: true, ...(system && { system }), messages: msgs, ...(temp != null && { temperature: temp }) }) }, signal);
    let inT = 0;
    for await (const j of sse(res)) {
      if (j.type === 'message_start') inT = j.message?.usage?.input_tokens || 0;
      else if (j.type === 'content_block_delta' && j.delta?.text) yield { text: j.delta.text };
      else if (j.type === 'message_delta' && j.usage) yield { usage: { in: inT, out: j.usage.output_tokens || 0 } };
      else if (j.type === 'error') throw new AIError('request', j.error?.message || 'Erro do provedor.');
    }
  } else { // gemini
    const contents = messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text || ' ' }, ...(m.images || []).map(i => ({ inline_data: { mime_type: i.mime, data: i.b64 } }))] }));
    const res = await http(`${base}/models/${encodeURIComponent(ai.model.replace(/^models\//, ''))}:streamGenerateContent?alt=sse`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents, ...(system && { systemInstruction: { parts: [{ text: system }] } }), ...(temp != null && { generationConfig: { temperature: temp } }) }) }, signal);
    for await (const j of sse(res)) {
      const t = j.candidates?.[0]?.content?.parts?.map(p => p.text || '').join(''); if (t) yield { text: t };
      if (j.usageMetadata) yield { usage: { in: j.usageMetadata.promptTokenCount || 0, out: j.usageMetadata.candidatesTokenCount || 0 } };
    }
  }
}

// Lista apenas modelos realmente disponíveis para a chave.
async function listModels(ai, key) {
  const P = PROVIDERS[ai.provider]; const base = (ai.base_url || P.base).replace(/\/$/, '');
  if (ai.provider === 'custom') await checkBase(base);
  if (P.kind === 'openai') {
    const r = await (await http(base + '/models', { headers: { authorization: 'Bearer ' + key } })).json();
    return (r.data || []).map(m => m.id).filter(Boolean).sort();
  }
  if (P.kind === 'anthropic') {
    const r = await (await http(base + '/models?limit=100', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } })).json();
    return (r.data || []).map(m => m.id);
  }
  const r = await (await http(base + '/models?pageSize=200', { headers: { 'x-goog-api-key': key } })).json();
  return (r.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => m.name.replace(/^models\//, ''));
}

// Informa recursos do modelo (heurística simples; o provedor continua sendo a fonte da verdade).
function capabilities(ai) {
  const m = ai.model.toLowerCase();
  const vision = ai.provider === 'anthropic' || ai.provider === 'gemini' || /gpt-4o|gpt-4\.1|gpt-5|vision|vl|llava|gemini|claude/.test(m);
  return { images: vision, files: true };
}
module.exports = { PROVIDERS, AIError, stream, listModels, capabilities, privateHost };
