'use strict';
const fs = require('fs');
const path = require('path');

/** Reprend l'historique des versions Python (historique.sqlite) si présent. La clé Gemini, chiffrée autrement, doit être ressaisie une fois. */
function migrateLegacy(store, legacyDir, marker) {
  const db = path.join(legacyDir || '', 'historique.sqlite');
  if (!legacyDir || !fs.existsSync(db) || fs.existsSync(marker)) return { migrated: 0 };
  let migrated = 0;
  try {
    const { DatabaseSync } = require('node:sqlite');
    const conn = new DatabaseSync(db, { readOnly: true });
    const rows = conn.prepare('SELECT career, created, question, answer FROM reports ORDER BY id ASC').all();
    conn.close();
    for (const r of rows) {
      const modeMatch = /^([^—]+?) — /.exec(r.question || '');
      store.addReport(r.career || 'Ma carrière', { mode: 'importé', question: modeMatch ? r.question.slice(modeMatch[0].length) : r.question, answer: r.answer || '', engine: 'ancienne version', model: '', images: 0 });
      migrated++;
    }
  } catch { return { migrated, error: true }; }
  fs.writeFileSync(marker, new Date().toISOString());
  return { migrated };
}

module.exports = { migrateLegacy };
