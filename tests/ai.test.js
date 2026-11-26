'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyze, geminiModels, pickGeminiDefault } = require('../main/ai');
const ollama = require('../main/ollama');
const { UpdateManager, friendly } = require('../main/updater');
const MD = require('../renderer/markdown');
const { buildPrompt } = require('../main/prompts');

const KEY = 'AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q';
const res = (status, json) => ({ ok: status < 400, status, json: async () => json, text: async () => JSON.stringify(json) });

test('Gemini : requête correcte (clé en en-tête, jamais dans l’URL, images A/B)', async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return res(200, { candidates: [{ content: { parts: [{ text: 'pensée', thought: true }, { text: 'Réponse FM' }] } }] }); };
  const out = await analyze({ provider: 'gemini', key: ` ${KEY}\n`, model: 'gemini-3.8-flash', mode: 'joueurs', question: 'Compare', context: '', history: [], images: ['aaa', 'bbb'], fetchImpl });
  assert.equal(out, 'Réponse FM');
  assert.ok(!seen.url.includes('key=') && !seen.url.includes(KEY));
  assert.equal(seen.init.headers['x-goog-api-key'], KEY);
  const parts = JSON.parse(seen.init.body).contents[0].parts;
  assert.equal(parts.filter((p) => p.inline_data).length, 2);
  assert.ok(parts.some((p) => p.text === 'Capture B :'));
});

test('Gemini : quota → erreur "quota", un seul appel (aucun nouvel essai)', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return res(429, { error: { status: 'RESOURCE_EXHAUSTED', message: 'quota', details: [{ retryDelay: '20s' }] } }); };
  await assert.rejects(analyze({ provider: 'gemini', key: KEY, model: 'gemini-3.8-flash', mode: 'tactique', question: 'q', images: ['a'], fetchImpl }), (e) => e.kind === 'quota' && e.retryAfter === 20);
  assert.equal(calls, 1);
});

test('Gemini : clé invalide, réseau coupé, message sans clé', async () => {
  const bad = async () => res(400, { error: { status: 'INVALID_ARGUMENT', message: `API key not valid ${KEY}`, details: [{ reason: 'API_KEY_INVALID' }] } });
  await assert.rejects(analyze({ provider: 'gemini', key: KEY, model: 'm', mode: 'tactique', question: 'q', images: [], fetchImpl: bad }), (e) => e.kind === 'invalid_key' && !e.message.includes(KEY));
  const down = async () => { throw new TypeError('fetch failed'); };
  await assert.rejects(analyze({ provider: 'gemini', key: KEY, model: 'm', mode: 'tactique', question: 'q', images: [], fetchImpl: down }), (e) => e.kind === 'connection');
  await assert.rejects(analyze({ provider: 'gemini', key: '', model: 'm', mode: 'tactique', question: 'q', images: [] }), (e) => e.kind === 'invalid_key');
});

test('Gemini : validation de clé par liste de modèles, filtre et choix par défaut', async () => {
  const mk = (name, methods = ['generateContent']) => ({ name: 'models/' + name, supportedGenerationMethods: methods });
  const fetchImpl = async () => res(200, { models: [mk('gemini-3.8-flash'), mk('gemini-3.8-flash-image'), mk('gemini-embedding-2', ['embedContent']), mk('gemini-2.5-pro'), mk('gemma-4-31b-it')] });
  const r = await geminiModels(KEY, { fetchImpl });
  assert.deepEqual(r.models, ['gemini-2.5-pro', 'gemini-3.8-flash']);
  assert.equal(r.default, 'gemini-3.8-flash');
  assert.equal(pickGeminiDefault([]), '');
  await assert.rejects(geminiModels('', {}), (e) => e.kind === 'invalid_key');
});

test('Ollama : format /api/chat, images, modèle gardé chargé ; erreurs typées', async () => {
  let body;
  const ok = async (url, init) => { body = JSON.parse(init.body); return res(200, { message: { content: 'ok local' } }); };
  assert.equal(await analyze({ provider: 'ollama', model: 'qwen3-vl:4b', mode: 'debrief', question: 'q', images: ['x'], fetchImpl: ok }), 'ok local');
  assert.equal(body.stream, false); assert.deepEqual(body.messages[0].images, ['x']); assert.equal(body.keep_alive, '15m');
  const noVision = async () => res(400, { error: 'this model does not support images' });
  await assert.rejects(analyze({ provider: 'ollama', model: 'llama3', mode: 'debrief', question: 'q', images: ['x'], fetchImpl: noVision }), (e) => e.kind === 'model_incompatible');
  const refused = async () => { throw new TypeError('ECONNREFUSED'); };
  await assert.rejects(analyze({ provider: 'ollama', model: 'm', mode: 'debrief', question: 'q', images: [], fetchImpl: refused }), (e) => e.kind === 'ollama_down');
});

test('Ollama : progression de téléchargement agrégée sur les couches, reprise possible', async () => {
  const lines = ['{"status":"pulling manifest"}', '{"status":"pulling a","digest":"sha256:a","total":1000,"completed":250}', '{"status":"pulling b","digest":"sha256:b","total":1000,"completed":750}', '{"error":"disque plein"}'];
  const enc = new TextEncoder(); let i = 0;
  const stream = { getReader: () => ({ read: async () => (i < lines.length ? { value: enc.encode(lines[i++] + '\n'), done: false } : { done: true }) }) };
  const seen = [];
  await assert.rejects(ollama.pull('qwen3-vl:4b', (p) => seen.push(p), undefined, async () => ({ ok: true, status: 200, body: stream })), /disque plein/);
  assert.equal(seen.at(-1).percent, 50);
});

test('prompt : sépare faits/hypothèses, interdit d’inventer les rôles, nomme les captures', () => {
  const p = buildPrompt({ mode: 'tactique', question: 'q', context: '', imageCount: 2, history: [] });
  assert.match(p, /N'invente aucun rôle ni consigne/); assert.match(p, /Capture A, B, C/); assert.match(p, /Problème observé/); assert.match(p, /Risque/);
  assert.match(buildPrompt({ mode: 'discussion', question: 'q', imageCount: 0 }), /Aucune capture jointe/);
});

test('Markdown : jamais de HTML brut, structure rendue', () => {
  const blocks = MD.parse('## Faits lus\n- **PL** : 12\n1. un\n\n<script>alert(1)</script>\n## Corrections');
  assert.equal(blocks[0].t, 'h'); assert.equal(blocks[1].t, 'list');
  assert.ok(blocks.some((b) => b.t === 'p' && b.children[0].v.includes('<script>'))); // texte brut, rendu via textContent
  assert.equal(MD.tone('Corrections'), 'good'); assert.equal(MD.tone('Informations manquantes'), 'warn');
});

test('mise à jour : états, hors-ligne silencieux, installation seulement si prête', async () => {
  const handlers = {}; const au = { on: (e, f) => { handlers[e] = f; }, checkForUpdates: async () => {}, quitAndInstall: () => { au.installed = true; } };
  const u = new UpdateManager({ autoUpdater: au, currentVersion: '2.0.0', packaged: true });
  assert.equal(u.install(), false);
  handlers['update-available']({ version: '2.1.0' }); handlers['download-progress']({ percent: 42.4 });
  assert.equal(u.state.percent, 42);
  handlers['update-downloaded']({ version: '2.1.0' }); assert.equal(u.state.state, 'ready');
  assert.equal(u.install(), true); assert.ok(au.installed);
  const off = new UpdateManager({ autoUpdater: { on() {}, checkForUpdates: async () => { throw new Error('getaddrinfo ENOTFOUND github.com'); } }, currentVersion: '2.0.0', packaged: true });
  assert.equal((await off.check({ silent: true })).state, 'offline');
  assert.match(friendly(new Error('sha512 checksum mismatch')), /rejeté/);
  assert.equal((await new UpdateManager({ autoUpdater: null, currentVersion: '2.0.0', packaged: false }).check()).state, 'dev');
});

test('Ollama : envoie think:false et réessaie sans si le modèle le refuse', async () => {
  const bodies = [];
  const fetchImpl = async (url, opts) => {
    const b = JSON.parse(opts.body); bodies.push(b);
    if ('think' in b) return { ok: false, status: 400, text: async () => '"model" does not support think' };
    return { ok: true, status: 200, json: async () => ({ message: { content: 'OK' } }) };
  };
  const { analyze } = require('../main/ai');
  const r = await analyze({ provider: 'ollama', model: 'qwen3-vl:4b', mode: 'discussion', question: 'x', images: [], fetchImpl });
  assert.ok(String(r.text ?? r).includes('OK'));
  assert.equal(bodies[0].think, false);
  assert.equal('think' in bodies[1], false);
});

test('ollama : modèle « réflexion » qui ne renvoie que son raisonnement → relance puis repli, jamais vide', async () => {
  let calls = 0;
  const fetchImpl = async (url, opts) => { calls++; const b = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({ message: { content: '', thinking: calls === 1 ? 'je réfléchis' : (b.messages[0].content.startsWith('/no_think') ? 'OK lu sur l’image' : '') } }), text: async () => '' }; };
  const out = await analyze({ provider: 'ollama', model: 'qwen3-vl:4b', mode: 'discussion', question: 'q', images: ['a'], fetchImpl });
  assert.equal(out, 'OK lu sur l’image');
  assert.equal(calls, 2);
});

test('la langue choisie est imposée au début et à la fin de la demande', () => {
  const { buildPrompt, buildLivePrompt } = require('../main/prompts');
  const p = buildPrompt({ mode: 'tactique', question: 'q', imageCount: 1, language: 'fr' });
  assert.match(p, /^[\s\S]*LANGUE DE RÉPONSE : Réponds UNIQUEMENT en français/);
  assert.match(p, /RAPPEL — Réponds UNIQUEMENT en français[^\n]*$/);
  assert.match(buildPrompt({ mode: 'tactique', question: 'q', imageCount: 0, language: 'es' }), /Responde SOLO en español/);
  assert.match(buildLivePrompt({ language: 'en' }), /Answer ONLY in English/);
  assert.match(buildPrompt({ mode: 'tactique', question: 'q', imageCount: 0 }), /UNIQUEMENT en français/); // par défaut
});

test('ollama en flux : le texte arrive au fur et à mesure, modèle instruct sans /no_think', async () => {
  const lines = ['{"message":{"content":"Bon"}}\n', '{"message":{"content":"jour"}}\n{"done":true}\n'];
  let sent;
  const fetchImpl = async (url, opts) => { sent = JSON.parse(opts.body); let i = 0; return { ok: true, status: 200, body: { getReader: () => ({ read: async () => (i < lines.length ? { done: false, value: new TextEncoder().encode(lines[i++]) } : { done: true }) }) } }; };
  const seen = [];
  const out = await analyze({ provider: 'ollama', model: 'qwen3-vl:4b-instruct', mode: 'discussion', question: 'q', images: ['a'], fetchImpl, onToken: (t) => seen.push(t) });
  assert.equal(out, 'Bonjour'); assert.deepEqual(seen, ['Bon', 'Bonjour']);
  assert.equal(sent.stream, true); assert.ok(!sent.messages[0].content.startsWith('/no_think')); assert.equal(sent.options.num_ctx, 8192);
});
