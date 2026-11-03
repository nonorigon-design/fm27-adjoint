'use strict';
const path = require('path');
const os = require('os');
const { AiError } = require('./errors');

/**
 * Installation de l'IA locale gratuite en une action :
 * 1. Ollama (winget d'abord : empreinte vérifiée par le catalogue ; sinon installateur officiel avec signature vérifiée)
 * 2. démarrage du serveur local
 * 3. modèle de vision adapté au matériel détecté (téléchargement avec progression, reprise possible)
 * 4. auto-test réel sur une image
 * Chaque dépendance est injectée pour pouvoir tester l'enchaînement sans Windows.
 */
async function setupLocalEngine({ ollama, hardware, selfTest, onStep, signal, tmpDir = os.tmpdir() }) {
  const step = (id, label, extra = {}) => onStep({ id, label, ...extra });
  const aborted = () => { if (signal?.aborted) throw new AiError('cancelled', 'Installation interrompue : relance pour reprendre.'); };

  step('hardware', 'Analyse de ton PC…');
  const hw = await hardware.detect();
  if (!hw.model) throw new AiError('memory', hw.reason);
  const model = hw.model;
  aborted();

  let st = await ollama.status();
  if (!st.installed) {
    step('install', 'Installation du moteur Ollama (gratuit, local)…', { indeterminate: true });
    let ok = false, wingetError = null;
    try { await ollama.installWithWinget(); ok = !!ollama.binaryPath(); } catch (e) { wingetError = e; }
    aborted();
    if (!ok) {
      step('install', 'Téléchargement de l’installateur officiel d’Ollama…', { percent: 0 });
      const file = path.join(tmpDir, 'OllamaSetup.exe');
      await ollama.downloadInstaller(file, (p) => step('install', 'Téléchargement de l’installateur officiel d’Ollama…', p), signal);
      aborted();
      const sig = await ollama.verifySignature(file);
      if (sig.status !== 'Valid' || !/ollama/i.test(sig.subject || '')) {
        throw new AiError('forbidden', `Installateur non reconnu (signature : ${sig.status}). Par sécurité il n’a pas été exécuté : installe Ollama depuis ollama.com/download.`);
      }
      step('install', 'Installation d’Ollama…', { indeterminate: true });
      await ollama.runSilent(file);
      if (!ollama.binaryPath()) throw new AiError('ollama_down', 'Ollama ne s’est pas installé correctement' + (wingetError ? ' (' + wingetError.message + ')' : '') + '.');
    }
    st = await ollama.status();
  }
  aborted();

  if (!st.running) { step('start', 'Démarrage du moteur…', { indeterminate: true }); st = await ollama.start(); }
  aborted();

  const have = st.models.map((m) => m.name);
  if (!have.includes(model.tag)) {
    step('model', `Téléchargement du modèle ${model.tag} (≈ ${model.sizeGb} Go)…`, { percent: 0, sizeGb: model.sizeGb });
    await ollama.pull(model.tag, (p) => step('model', `Téléchargement du modèle ${model.tag} (≈ ${model.sizeGb} Go)…`, { percent: p.percent, done: p.done, total: p.total, sizeGb: model.sizeGb }), signal);
  }
  aborted();

  step('test', 'Vérification : l’IA lit une image…', { indeterminate: true });
  await selfTest(model.tag);
  step('done', 'Ton adjoint IA est prêt.', { percent: 100 });
  return { model: model.tag, hardware: hw };
}

module.exports = { setupLocalEngine };
