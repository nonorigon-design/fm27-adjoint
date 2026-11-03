'use strict';
const fs = require('fs');
const path = require('path');
const { normalizeKey } = require('./util');

/**
 * Clé Gemini protégée par le compte Windows (Electron safeStorage = DPAPI sous Windows).
 * Jamais écrite en clair : si le chiffrement n'est pas disponible, on refuse de mémoriser.
 */
class KeyStore {
  constructor(dir, safeStorage, file = 'gemini-key.bin') {
    this.file = path.join(dir, file);
    this.safe = safeStorage;
    fs.mkdirSync(dir, { recursive: true });
  }
  available() { return !!this.safe && this.safe.isEncryptionAvailable(); }
  has() { return fs.existsSync(this.file); }
  save(raw) {
    const key = normalizeKey(raw);
    if (!key) throw new Error('La clé est vide.');
    if (!this.available()) throw new Error('Le chiffrement du compte Windows est indisponible : la clé ne sera pas mémorisée en clair.');
    const enc = this.safe.encryptString(key);
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, enc);
    fs.renameSync(tmp, this.file);
  }
  load() {
    if (!this.has()) return '';
    if (!this.available()) return '';
    try { return normalizeKey(this.safe.decryptString(fs.readFileSync(this.file))); } catch { return ''; }
  }
  forget() { try { fs.unlinkSync(this.file); } catch { /* déjà absente */ } }
}

module.exports = { KeyStore };
