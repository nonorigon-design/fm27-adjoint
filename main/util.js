'use strict';
// Utilitaires purs (aucune dépendance Electron) : faciles à tester.

/** Retire espaces, retours à la ligne, caractères invisibles et guillemets de collage. La clé elle-même n'est pas modifiée. */
function normalizeKey(value) {
  return String(value ?? '')
    .replace(/[\s​-‍﻿ ]+/g, '')
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '');
}

const KEY_PATTERNS = [/AIza[0-9A-Za-z_\-]{30,}/g, /(x-goog-api-key["']?\s*[:=]\s*["']?)[^\s"',]+/gi, /([?&]key=)[^&\s"']+/gi];

/** Masque toute clé API probable avant écriture dans un journal ou un message d'erreur. */
function redact(text, knownSecrets = []) {
  let out = String(text ?? '');
  for (const secret of knownSecrets) {
    if (secret && secret.length >= 8) out = out.split(secret).join('[clé masquée]');
  }
  out = out.replace(KEY_PATTERNS[0], '[clé masquée]');
  out = out.replace(KEY_PATTERNS[1], '$1[clé masquée]');
  out = out.replace(KEY_PATTERNS[2], '$1[clé masquée]');
  return out;
}

const MODIFIERS = new Set(['CommandOrControl', 'Control', 'Ctrl', 'Alt', 'Shift', 'Super']);
/** Vérifie qu'un raccourci global est raisonnable : au moins un modificateur + une touche. */
function validAccelerator(acc) {
  if (typeof acc !== 'string') return false;
  const parts = acc.split('+');
  if (parts.length < 2) return false;
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  if (!mods.every((m) => MODIFIERS.has(m))) return false;
  return /^([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|Space|Tab|Up|Down|Left|Right|Home|End|PageUp|PageDown|Insert|Delete|Return|Plus|-)$/.test(key);
}

function sanitizeCareer(name) {
  const clean = String(name ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80);
  return clean || 'Ma carrière';
}

module.exports = { normalizeKey, redact, validAccelerator, sanitizeCareer };
