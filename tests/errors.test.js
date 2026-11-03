'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyGemini, classifyOllama } = require('../main/errors');

const body = (status, message, details = []) => ({ error: { code: 0, message, status, details } });

test('clé invalide ≠ quota ≠ accès refusé', () => {
  const invalid = classifyGemini(400, body('INVALID_ARGUMENT', 'API key not valid. Please pass a valid API key.', [{ reason: 'API_KEY_INVALID' }]));
  assert.equal(invalid.kind, 'invalid_key');
  const quota = classifyGemini(429, body('RESOURCE_EXHAUSTED', 'You exceeded your current quota'));
  assert.equal(quota.kind, 'quota');
  assert.match(quota.message, /ta clé est valide/);
  const denied = classifyGemini(403, body('PERMISSION_DENIED', 'Permission denied'));
  assert.equal(denied.kind, 'forbidden');
});

test('quota : distingue limite par minute et journalière, lit le délai', () => {
  const day = classifyGemini(429, body('RESOURCE_EXHAUSTED', 'quota', [
    { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] },
    { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '37s' }]));
  assert.match(day.message, /JOURNALIER/);
  assert.equal(day.retryAfter, 37);
  const min = classifyGemini(429, body('RESOURCE_EXHAUSTED', 'quota', [{ violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel' }] }]));
  assert.match(min.message, /PAR MINUTE/);
});

test('quota : jamais de promesse de passage payant ni de nouvel essai', () => {
  const q = classifyGemini(429, body('RESOURCE_EXHAUSTED', 'x'));
  assert.match(q.message, /Aucun nouvel essai automatique et aucun passage payant/);
});

test('restrictions de clé, modèle absent, modèle sans image, serveur', () => {
  assert.equal(classifyGemini(403, body('PERMISSION_DENIED', 'blocked', [{ reason: 'API_KEY_SERVICE_BLOCKED' }])).kind, 'forbidden');
  assert.equal(classifyGemini(404, body('NOT_FOUND', 'models/x is not found')).kind, 'model_missing');
  assert.equal(classifyGemini(400, body('INVALID_ARGUMENT', 'Image input modality is not enabled for models/x')).kind, 'model_incompatible');
  assert.equal(classifyGemini(503, null).kind, 'server');
  assert.equal(classifyGemini(401, null).kind, 'invalid_key');
});

test('Ollama : modèle sans vision, mémoire, absent', () => {
  assert.equal(classifyOllama(400, '{"error":"this model does not support images"}').kind, 'model_incompatible');
  assert.equal(classifyOllama(500, 'model requires more system memory (9.1 GiB) than is available').kind, 'memory');
  assert.equal(classifyOllama(404, 'model "x" not found, try pulling it first').kind, 'model_missing');
});
