'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sanitizeCareer } = require('./util');

/** Stockage JSON atomique, une carrière = un fichier. Pas de dépendance native. */
class Store {
  constructor(dir) {
    this.dir = path.join(dir, 'carrieres');
    fs.mkdirSync(this.dir, { recursive: true });
  }
  _file(career) {
    const name = sanitizeCareer(career);
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'carriere';
    const hash = crypto.createHash('sha1').update(name).digest('hex').slice(0, 8);
    return path.join(this.dir, `${slug}-${hash}.json`);
  }
  _read(career) {
    const f = this._file(career);
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return { name: sanitizeCareer(career), reports: [], messages: [], changes: [] }; }
  }
  _write(career, data) {
    const f = this._file(career);
    const tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
    fs.renameSync(tmp, f);
  }
  careers() {
    const out = [];
    for (const f of fs.readdirSync(this.dir)) {
      if (!f.endsWith('.json')) continue;
      try { out.push(JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8')).name); } catch { /* fichier ignoré */ }
    }
    return out.sort((a, b) => a.localeCompare(b, 'fr'));
  }
  addReport(career, { mode, question, answer, engine, model, images = 0 }) {
    const d = this._read(career);
    d.reports.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), mode, question, answer, engine, model, images });
    d.reports = d.reports.slice(0, 200);
    this._write(career, d);
    return d.reports[0];
  }
  reports(career) { return this._read(career).reports; }
  addMessage(career, role, text) {
    const d = this._read(career);
    d.messages.push({ at: new Date().toISOString(), role, text });
    d.messages = d.messages.slice(-200);
    this._write(career, d);
  }
  messages(career) { return this._read(career).messages; }
  /** Historique des changements tactiques testés, pour comparer leurs résultats. */
  addChange(career, { description, before = '', after = '' }) {
    const d = this._read(career);
    const entry = { id: crypto.randomUUID(), at: new Date().toISOString(), description: String(description).slice(0, 500), before: String(before).slice(0, 500), after: String(after).slice(0, 500), verdict: '' };
    d.changes.unshift(entry);
    this._write(career, d);
    return entry;
  }
  updateChange(career, id, patch) {
    const d = this._read(career);
    const c = d.changes.find((x) => x.id === id);
    if (!c) return null;
    for (const k of ['description', 'before', 'after', 'verdict']) if (typeof patch[k] === 'string') c[k] = patch[k].slice(0, 500);
    this._write(career, d);
    return c;
  }
  changes(career) { return this._read(career).changes; }
  /** Contexte envoyé au moteur : derniers rapports, derniers messages, changements testés. Borné. */
  context(career, maxChars = 12000) {
    const d = this._read(career);
    const parts = [];
    if (d.changes.length) {
      parts.push('Changements tactiques testés (du plus récent au plus ancien) :\n' + d.changes.slice(0, 8).map((c) => `- ${c.at.slice(0, 10)} : ${c.description}${c.after ? ' | résultat noté : ' + c.after : ''}${c.verdict ? ' | verdict : ' + c.verdict : ''}`).join('\n'));
    }
    if (d.reports.length) parts.push('Derniers rapports :\n' + d.reports.slice(0, 3).reverse().map((r) => `${r.at.slice(0, 10)} [${r.mode}] ${r.question}\n${r.answer.slice(0, 2500)}`).join('\n\n'));
    return parts.join('\n\n').slice(-maxChars);
  }
}

module.exports = { Store };
