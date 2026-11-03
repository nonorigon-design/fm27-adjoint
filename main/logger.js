'use strict';
const fs = require('fs');
const path = require('path');
const { redact } = require('./util');

/** Journal local avec masquage systématique des clés. Rien n'est envoyé nulle part. */
function createLogger(dir, getSecrets = () => []) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'application.log');
  const write = (level, msg) => {
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > 1_000_000) fs.renameSync(file, file + '.old');
      fs.appendFileSync(file, `${new Date().toISOString()} [${level}] ${redact(msg, getSecrets())}\n`);
    } catch { /* le journal ne doit jamais faire planter l'application */ }
  };
  return { file, info: (m) => write('info', m), warn: (m) => write('warn', m), error: (m) => write('error', m) };
}

module.exports = { createLogger };
