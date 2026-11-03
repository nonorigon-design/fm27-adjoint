'use strict';
// Classification des erreurs IA : on ne confond jamais clé invalide, accès refusé, quota, modèle et réseau.

class AiError extends Error {
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'AiError';
    this.kind = kind; // invalid_key | forbidden | quota | model_missing | model_incompatible | connection | server | memory | ollama_down | empty | bad_request
    Object.assign(this, extra);
  }
}

function parseDelay(details) {
  for (const d of details || []) {
    if (typeof d?.retryDelay === 'string') {
      const m = /^(\d+(?:\.\d+)?)s$/.exec(d.retryDelay);
      if (m) return Math.ceil(parseFloat(m[1]));
    }
  }
  return null;
}

function violations(details) {
  const out = [];
  for (const d of details || []) for (const v of d?.violations || []) out.push(String(v.quotaId || v.quotaMetric || ''));
  return out;
}

/** status = code HTTP ; body = JSON déjà analysé (ou null). */
function classifyGemini(status, body) {
  const error = body?.error || {};
  const details = error.details || [];
  const reasons = details.map((d) => d?.reason).filter(Boolean);
  const msg = String(error.message || '');
  const gStatus = String(error.status || '');

  if (reasons.includes('API_KEY_INVALID') || /API key not valid|API_KEY_INVALID/i.test(msg)) {
    return new AiError('invalid_key', 'Clé Gemini invalide : Google ne la reconnaît pas. Recopie la clé complète depuis Google AI Studio (elle a peut-être été supprimée ou tronquée).');
  }
  if (reasons.some((r) => /API_KEY_(SERVICE|HTTP|IP|ANDROID|IOS)/.test(r)) || reasons.includes('API_KEY_SERVICE_BLOCKED')) {
    return new AiError('forbidden', 'Accès refusé : la clé existe mais ses restrictions (API ou application) bloquent l’API Gemini. Vérifie les restrictions de la clé dans Google Cloud.');
  }
  if (status === 429 || gStatus === 'RESOURCE_EXHAUSTED') {
    const ids = violations(details).join(' ');
    const wait = parseDelay(details);
    let scope = '';
    if (/PerDay/i.test(ids)) scope = ' Il s’agit du quota JOURNALIER : il se renouvelle à minuit (heure du Pacifique), inutile de réessayer avant.';
    else if (/PerMinute/i.test(ids)) scope = ' Il s’agit d’une limite PAR MINUTE : patiente un peu.';
    const delay = wait ? ` Google indique d’attendre environ ${wait} s.` : '';
    return new AiError('quota', `Quota Gemini atteint (ta clé est valide).${scope}${delay} Aucun nouvel essai automatique et aucun passage payant. Tu peux attendre, changer de modèle, ou utiliser le moteur local.`, { retryAfter: wait });
  }
  if (status === 403 || gStatus === 'PERMISSION_DENIED') {
    if (/location is not supported/i.test(msg)) return new AiError('forbidden', 'Accès refusé : Gemini n’est pas proposé depuis ta région avec ce compte.');
    return new AiError('forbidden', 'Accès refusé : la clé est reconnue mais son projet n’a pas le droit d’utiliser ce service ou ce modèle. Vérifie le projet dans Google AI Studio.');
  }
  if (status === 401) return new AiError('invalid_key', 'Clé Gemini non acceptée (authentification refusée). Recopie-la depuis Google AI Studio.');
  if (status === 404 || gStatus === 'NOT_FOUND') {
    return new AiError('model_missing', 'Modèle introuvable ou retiré : actualise la liste des modèles et choisis-en un autre.');
  }
  if (status === 400) {
    if (/image|inline_data|mime|modalit/i.test(msg)) return new AiError('model_incompatible', 'Ce modèle n’accepte pas les images. Choisis un modèle Gemini compatible vision.');
    return new AiError('bad_request', 'Requête refusée par Gemini : ' + msg.slice(0, 200));
  }
  if (status >= 500) return new AiError('server', `Le service Gemini rencontre un problème temporaire (HTTP ${status}). Réessaie plus tard.`);
  return new AiError('server', `Réponse inattendue de Gemini (HTTP ${status}).`);
}

function classifyOllama(status, text) {
  const msg = String(text || '');
  if (/does not support (image|vision)|image input|multimodal|vision/i.test(msg) && status >= 400) {
    return new AiError('model_incompatible', 'Ce modèle local ne lit pas les images. Choisis un modèle avec vision (ex. qwen3-vl).');
  }
  if (/requires more system memory|out of memory|insufficient memory|failed to allocate/i.test(msg)) {
    return new AiError('memory', 'Pas assez de mémoire pour ce modèle pendant que FM tourne. Choisis un modèle plus petit.');
  }
  if (status === 404 || /not found/i.test(msg)) return new AiError('model_missing', 'Modèle local absent : télécharge-le depuis les réglages IA.');
  return new AiError('server', `Ollama a renvoyé une erreur (HTTP ${status}) : ${msg.slice(0, 200)}`);
}

function connectionError(target) {
  if (target === 'ollama') return new AiError('ollama_down', 'Ollama ne répond pas. Il n’est peut-être pas installé ou démarré : ouvre les réglages IA pour le vérifier.');
  return new AiError('connection', 'Connexion à Gemini impossible ou délai dépassé. Vérifie ta connexion Internet.');
}

module.exports = { AiError, classifyGemini, classifyOllama, connectionError };
