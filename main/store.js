'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sanitizeCareer } = require('./util');
const { similar } = require('./reader');

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
  /**
   * Lecture automatique d'un écran : met à jour le dossier (dernier état lu par type d'écran)
   * et ajoute les nouveaux conseils, sans doublon. Renvoie les conseils réellement ajoutés.
   */
  addReading(career, reading) {
    const d = this._read(career);
    d.dossier = d.dossier || {}; d.conseils = d.conseils || [];
    const at = new Date().toISOString();
    if (reading.faits.length) d.dossier[reading.ecran] = { titre: reading.titre_ecran, faits: reading.faits, at };
    const added = [];
    for (const c of reading.conseils) {
      const same = d.conseils.find((x) => similar(x, c));
      if (same) { if (same.status === 'nouveau') { same.vu = (same.vu || 1) + 1; same.at = at; if (c.priorite === 'urgent') same.priorite = 'urgent'; } continue; }
      const entry = { id: crypto.randomUUID(), at, ecran: reading.ecran, status: 'nouveau', vu: 1, ...c };
      d.conseils.unshift(entry); added.push(entry);
    }
    // Garde les conseils récents ; les « appliqués » et « refusés » restent un moment pour ne pas être redonnés.
    d.conseils = d.conseils.slice(0, 80);
    this._write(career, d);
    return added;
  }
  board(career) { const d = this._read(career); return { conseils: d.conseils || [], dossier: d.dossier || {} }; }
  setConseil(career, id, status) {
    if (!['nouveau', 'fait', 'refuse', 'archive'].includes(status)) return null;
    const d = this._read(career);
    const c = (d.conseils || []).find((x) => x.id === id);
    if (!c) return null;
    c.status = status; c.decidedAt = new Date().toISOString();
    this._write(career, d);
    return c;
  }
  /** Ce que l'adjoint sait déjà : faits lus sur les autres écrans + conseils déjà donnés, appliqués ou refusés. */
  readerContext(career, maxChars = 3500) {
    const d = this._read(career);
    const parts = [];
    const dossier = Object.entries(d.dossier || {}).sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, 6);
    for (const [ecran, v] of dossier) parts.push(`- ${ecran} (${v.at.slice(0, 16).replace('T', ' ')}) : ` + v.faits.slice(0, 10).map((f) => `${f.sujet} = ${f.valeur}`).join(' ; '));
    const list = (st) => (d.conseils || []).filter((c) => c.status === st).slice(0, 12).map((c) => c.titre).join(' | ');
    if (list('nouveau')) parts.push('Conseils déjà affichés (ne pas répéter) : ' + list('nouveau'));
    if (list('fait')) parts.push('Conseils déjà appliqués par le joueur : ' + list('fait'));
    if (list('refuse')) parts.push('Conseils refusés par le joueur (ne plus les proposer) : ' + list('refuse'));
    return parts.join('\n').slice(0, maxChars);
  }
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
