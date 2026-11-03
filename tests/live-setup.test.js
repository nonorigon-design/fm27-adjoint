'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LiveCoach } = require('../main/live');
const { setupLocalEngine } = require('../main/engine-setup');
const { AiError } = require('../main/errors');

// ----- Coach en direct -----
function harness(analyze, opts = {}) {
  let t = 0; const timers = []; const events = [];
  const coach = new LiveCoach({ analyze, emit: (e) => events.push(e), now: () => t, setTimer: (fn, ms) => { const h = { fn, at: t + ms }; timers.push(h); return h; }, clearTimer: (h) => { h.dead = true; }, minIntervalMs: 10000, ...opts });
  const tick = async (ms) => { t += ms; for (const h of timers.filter((x) => !x.dead && x.at <= t)) { h.dead = true; h.fn(); } await new Promise((r) => setImmediate(r)); };
  return { coach, events, tick, items: () => events.filter((e) => e.type === 'item') };
}

test('direct : ne fait rien tant qu’il est arrêté, analyse un écran à la fois', async () => {
  let calls = 0; const h = harness(async () => { calls++; return 'Conseil ' + calls; });
  h.coach.onScreen({ thumb: 'x' }); await h.tick(0); assert.equal(calls, 0);
  h.coach.start(); h.coach.onScreen({ thumb: 'a' }); await h.tick(0);
  assert.equal(calls, 1); assert.equal(h.items().at(-1).state, 'done');
});

test('direct : délai minimum, et seul l’écran le plus récent est gardé', async () => {
  const seen = []; const h = harness(async (p) => { seen.push(p.thumb); return 'ok ' + p.thumb; });
  h.coach.start();
  h.coach.onScreen({ thumb: 'A' }); await h.tick(0);
  h.coach.onScreen({ thumb: 'B' }); h.coach.onScreen({ thumb: 'C' }); await h.tick(1000);
  assert.deepEqual(seen, ['A']);        // trop tôt
  await h.tick(9500);
  assert.deepEqual(seen, ['A', 'C']);   // B abandonné, C analysé
});

test('direct : « RAS » ne produit pas de conseil, et les conseils passés sont fournis pour éviter les répétitions', async () => {
  const prevs = []; const answers = ['Conseil 1', 'RAS']; const h = harness(async (p, prev) => { prevs.push([...prev]); return answers.shift(); });
  h.coach.start();
  h.coach.onScreen({ thumb: '1' }); await h.tick(0);
  h.coach.onScreen({ thumb: '2' }); await h.tick(10000);
  assert.deepEqual(prevs[1], ['Conseil 1']);
  assert.equal(h.items().filter((e) => e.state === 'quiet').length, 1);
});

test('direct : s’arrête seul sur quota, ou après trois erreurs d’affilée', async () => {
  const q = harness(async () => { throw new AiError('quota', 'quota'); });
  q.coach.start(); q.coach.onScreen({ thumb: 'x' }); await q.tick(0);
  assert.equal(q.coach.on, false); assert.equal(q.events.at(-1).reason, 'quota');
  const e = harness(async () => { throw new Error('boom'); });
  e.coach.start();
  for (let i = 0; i < 3; i++) { e.coach.onScreen({ thumb: String(i) }); await e.tick(10000); }
  assert.equal(e.coach.on, false); assert.equal(e.events.at(-1).reason, 'errors');
});

// ----- Installation automatique -----
const hardware = { detect: async () => ({ ramGb: 16, vramGb: 8, model: { tag: 'qwen3-vl:4b', sizeGb: 3.3 }, reason: 'ok' }) };
function fakeOllama(over = {}) {
  const log = []; let installed = false, running = false; const models = [];
  const o = {
    log,
    status: async () => ({ installed, running, models: models.map((name) => ({ name })) }),
    binaryPath: () => (installed ? 'ollama.exe' : null),
    installWithWinget: async () => { log.push('winget'); installed = true; },
    downloadInstaller: async (f, cb) => { log.push('download'); cb({ percent: 100 }); },
    verifySignature: async () => ({ status: 'Valid', subject: 'CN=Ollama Inc.' }),
    runSilent: async () => { log.push('run'); installed = true; },
    start: async () => { log.push('start'); running = true; return { installed, running, models: [] }; },
    pull: async (tag, cb) => { log.push('pull ' + tag); cb({ percent: 50, done: 1, total: 2 }); models.push(tag); },
    ...over,
  };
  return o;
}

test('installation : winget → démarrage → modèle adapté → auto-test, dans l’ordre', async () => {
  const o = fakeOllama(); const steps = []; let tested = null;
  const r = await setupLocalEngine({ ollama: o, hardware, selfTest: async (t) => { tested = t; }, onStep: (s) => steps.push(s.id) });
  assert.deepEqual(o.log, ['winget', 'start', 'pull qwen3-vl:4b']);
  assert.equal(tested, 'qwen3-vl:4b'); assert.equal(r.model, 'qwen3-vl:4b'); assert.equal(steps.at(-1), 'done');
});

test('installation : repli sur l’installateur officiel si winget échoue, signature exigée', async () => {
  const o = fakeOllama({ installWithWinget: async () => { throw new Error('winget introuvable'); } });
  await setupLocalEngine({ ollama: o, hardware, selfTest: async () => {}, onStep() {} });
  assert.deepEqual(o.log.slice(0, 2), ['download', 'run']);
  const bad = fakeOllama({ installWithWinget: async () => { throw new Error('x'); }, verifySignature: async () => ({ status: 'NotSigned', subject: '' }) });
  await assert.rejects(setupLocalEngine({ ollama: bad, hardware, selfTest: async () => {}, onStep() {} }), (e) => e.kind === 'forbidden');
  assert.ok(!bad.log.includes('run'), 'un installateur non signé n’est jamais exécuté');
});

test('installation : saute ce qui est déjà fait, refuse un PC trop juste, échoue si le modèle ne lit pas les images', async () => {
  const o = fakeOllama({ status: async () => ({ installed: true, running: true, models: [{ name: 'qwen3-vl:4b' }] }) });
  await setupLocalEngine({ ollama: o, hardware, selfTest: async () => {}, onStep() {} });
  assert.deepEqual(o.log, []);
  const weak = { detect: async () => ({ model: null, reason: 'Matériel trop juste' }) };
  await assert.rejects(setupLocalEngine({ ollama: fakeOllama(), hardware: weak, selfTest: async () => {}, onStep() {} }), (e) => e.kind === 'memory');
  await assert.rejects(setupLocalEngine({ ollama: fakeOllama(), hardware, selfTest: async () => { throw new AiError('model_incompatible', 'x'); }, onStep() {} }), (e) => e.kind === 'model_incompatible');
});

test('installation : interruption propre', async () => {
  const ctl = new AbortController(); const o = fakeOllama({ installWithWinget: async () => { ctl.abort(); } });
  await assert.rejects(setupLocalEngine({ ollama: o, hardware, selfTest: async () => {}, onStep() {}, signal: ctl.signal }), (e) => e.kind === 'cancelled');
});
