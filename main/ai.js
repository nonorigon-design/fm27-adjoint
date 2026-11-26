'use strict';
const { AiError, classifyGemini, classifyOllama, connectionError } = require('./errors');
const { normalizeKey, redact } = require('./util');
const { buildPrompt } = require('./prompts');

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
const OLLAMA = 'http://127.0.0.1:11434';

// Modèles privilégiés par défaut (gratuits d'après la page de tarifs Google, relevée en octobre 2026).
// La liste de l'API ne dit PAS si un modèle est gratuit pour ton projet : le quota réel dépend de ton compte.
const GEMINI_PREFERRED = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash'];
const EXCLUDE = /(image|tts|audio|live|embedding|robotics|computer-use|veo|imagen|aqa|thinking-exp|native)/i;

function pickGeminiDefault(names) {
  for (const p of GEMINI_PREFERRED) if (names.includes(p)) return p;
  return names.find((n) => /flash/.test(n) && !/preview|exp/.test(n)) || names[0] || '';
}

async function readJson(res) { try { return await res.json(); } catch { return null; } }

async function geminiFetch(url, { key, body, signal, fetchImpl = fetch }) {
  const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': normalizeKey(key) };
  let res;
  try {
    res = await fetchImpl(url, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, signal });
  } catch (e) {
    if (e?.name === 'AbortError') throw new AiError('cancelled', 'Analyse annulée.');
    throw connectionError('gemini');
  }
  if (!res.ok) throw classifyGemini(res.status, await readJson(res));
  return res.json();
}

/** Liste les modèles Gemini texte+image ; sert aussi à VALIDER la clé sans consommer de quota de génération. */
async function geminiModels(key, opts = {}) {
  if (!normalizeKey(key)) throw new AiError('invalid_key', 'Aucune clé Gemini renseignée.');
  const names = [];
  let token = '';
  for (let page = 0; page < 10; page++) {
    const url = `${GEMINI}/models?pageSize=100${token ? '&pageToken=' + encodeURIComponent(token) : ''}`;
    const data = await geminiFetch(url, { key, ...opts });
    for (const m of data.models || []) {
      const name = String(m.name || '').replace(/^models\//, '');
      if ((m.supportedGenerationMethods || []).includes('generateContent') && /^gemini/.test(name) && !EXCLUDE.test(name)) names.push(name);
    }
    token = data.nextPageToken || '';
    if (!token) break;
  }
  names.sort();
  return { models: names, default: pickGeminiDefault(names) };
}

async function geminiAnalyze({ key, model, prompt, images, signal, fetchImpl, maxTokens }) {
  if (!/^[A-Za-z0-9_.\-]+$/.test(model || '')) throw new AiError('model_missing', 'Choisis un modèle Gemini.');
  const parts = [{ text: prompt }];
  images.forEach((b64, i) => {
    parts.push({ text: `Capture ${String.fromCharCode(65 + i)} :` });
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: b64 } });
  });
  const data = await geminiFetch(`${GEMINI}/models/${model}:generateContent`, {
    key, signal, fetchImpl, body: { contents: [{ role: 'user', parts }], ...(maxTokens ? { generationConfig: { maxOutputTokens: maxTokens } } : {}) },
  });
  const cand = (data.candidates || [])[0];
  const text = (cand?.content?.parts || []).filter((p) => !p.thought && p.text).map((p) => p.text).join('\n').trim();
  if (!text) {
    const why = cand?.finishReason || data.promptFeedback?.blockReason || '';
    throw new AiError('empty', `Gemini n’a renvoyé aucun texte${why ? ' (' + why + ')' : ''}. Essaie un autre modèle ou reformule.`);
  }
  return text;
}

async function ollamaFetch(path, { body, signal, fetchImpl = fetch, method } = {}) {
  let res;
  try {
    res = await fetchImpl(OLLAMA + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal });
  } catch (e) {
    if (e?.name === 'AbortError') throw new AiError('cancelled', 'Analyse annulée.');
    throw connectionError('ollama');
  }
  if (!res.ok) throw classifyOllama(res.status, await res.text().catch(() => ''));
  return res;
}

const isThinkingModel = (m) => /qwen3-vl/i.test(m) && !/instruct/i.test(m);

/** Lit une réponse Ollama en flux (NDJSON) et rappelle onToken avec le texte complet reçu jusque-là. */
async function readStream(res, onToken) {
  const reader = res.body.getReader(); const dec = new TextDecoder();
  let buf = '', content = '', thinking = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line) continue;
      let j; try { j = JSON.parse(line); } catch { continue; }
      if (j.error) throw new AiError('server', 'Ollama : ' + String(j.error).slice(0, 200));
      if (j.message?.content) { content += j.message.content; onToken(content); }
      if (j.message?.thinking) thinking += j.message.thinking;
    }
  }
  return { message: { content, thinking } };
}

async function ollamaAnalyze({ model, prompt, images, signal, fetchImpl, maxTokens, onToken }) {
  if (!/^[A-Za-z0-9_.:\-\/]+$/.test(model || '')) throw new AiError('model_missing', 'Choisis un modèle local.');
  const thinking = isThinkingModel(model);
  const stream = typeof onToken === 'function';
  const body = {
    model, stream,
    keep_alive: '15m', // garde le modèle chargé entre deux analyses : pas de rechargement de plusieurs secondes à chaque fois
    options: { num_ctx: thinking ? 16384 : 8192, temperature: 0.3, num_predict: maxTokens || 900 },
    messages: [{ role: 'user', content: (thinking ? '/no_think\n' : '') + prompt, images }],
  };
  const send = async (b) => { const r = await ollamaFetch('/api/chat', { signal, fetchImpl, body: b }); return stream ? readStream(r, onToken) : r.json(); };
  // think:false — sinon les modèles « réflexion » dépensent tout leur budget en raisonnement caché.
  let data;
  try { data = await send({ ...body, think: false }); }
  catch (e) {
    if (!(e.kind === 'server' && /HTTP 400|think/i.test(e.message))) throw e; // ancienne version d'Ollama ou modèle sans option « think »
    data = await send(body);
  }
  let text = String(data?.message?.content || '').trim();
  if (!text && thinking) {
    const retry = { ...body, options: { ...body.options, num_predict: Math.max(1500, (maxTokens || 0) * 3) } };
    try { data = await send({ ...retry, think: false }); text = String(data?.message?.content || '').trim(); }
    catch (e) { if (e?.kind === 'cancelled') throw e; }
  }
  if (!text) text = String(data?.message?.thinking || '').replace(/<\/?think>/g, '').trim();
  if (!text) throw new AiError('empty', 'Le modèle local n’a renvoyé aucun texte. Mets Ollama à jour (ollama.com/download) ou choisis un autre modèle avec vision.');
  return text;
}

async function analyze({ provider, key, model, mode, question, context, history, images, signal, fetchImpl, prompt: custom, maxTokens, language, onToken }) {
  const prompt = custom || buildPrompt({ mode, question, context, history, imageCount: images.length, language });
  try {
    if (provider === 'ollama') return await ollamaAnalyze({ model, prompt, images, signal, fetchImpl, maxTokens, onToken });
    if (!normalizeKey(key)) throw new AiError('invalid_key', 'Aucune clé Gemini enregistrée : ouvre les réglages IA.');
    return await geminiAnalyze({ key, model, prompt, images, signal, fetchImpl, maxTokens });
  } catch (e) {
    if (e instanceof AiError) { e.message = redact(e.message, [key]); throw e; }
    throw new AiError('server', redact(String(e?.message || e), [key]));
  }
}

module.exports = { analyze, geminiModels, ollamaFetch, pickGeminiDefault, OLLAMA, GEMINI };
