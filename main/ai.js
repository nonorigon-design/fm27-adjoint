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

async function ollamaAnalyze({ model, prompt, images, signal, fetchImpl, maxTokens }) {
  if (!/^[A-Za-z0-9_.:\-\/]+$/.test(model || '')) throw new AiError('model_missing', 'Choisis un modèle local.');
  const res = await ollamaFetch('/api/chat', {
    signal, fetchImpl,
    body: {
      model, stream: false,
      keep_alive: '2m', // libère la mémoire peu après l'analyse pour ne pas pénaliser FM
      options: { num_ctx: 8192, temperature: 0.3, ...(maxTokens ? { num_predict: maxTokens } : {}) },
      messages: [{ role: 'user', content: prompt, images }],
    },
  });
  const data = await res.json();
  const text = String(data?.message?.content || '').trim();
  if (!text) throw new AiError('empty', 'Le modèle local n’a renvoyé aucun texte. Essaie un autre modèle avec vision.');
  return text;
}

async function analyze({ provider, key, model, mode, question, context, history, images, signal, fetchImpl, prompt: custom, maxTokens }) {
  const prompt = custom || buildPrompt({ mode, question, context, history, imageCount: images.length });
  try {
    if (provider === 'ollama') return await ollamaAnalyze({ model, prompt, images, signal, fetchImpl, maxTokens });
    if (!normalizeKey(key)) throw new AiError('invalid_key', 'Aucune clé Gemini enregistrée : ouvre les réglages IA.');
    return await geminiAnalyze({ key, model, prompt, images, signal, fetchImpl, maxTokens });
  } catch (e) {
    if (e instanceof AiError) { e.message = redact(e.message, [key]); throw e; }
    throw new AiError('server', redact(String(e?.message || e), [key]));
  }
}

module.exports = { analyze, geminiModels, ollamaFetch, pickGeminiDefault, OLLAMA, GEMINI };
