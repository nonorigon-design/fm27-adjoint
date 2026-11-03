'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { Store } = require('../main/store');
const { recommend } = require('../main/hardware');
const { ChangeDetector, distance, mostlyBlack } = require('../main/diff');
const { migrateLegacy } = require('../main/legacy');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fm27-'));

test('historique séparé par carrière, persistant, contexte borné', () => {
  const dir = tmp(); const s = new Store(dir);
  s.addReport('Lyon', { mode: 'tactique', question: 'q1', answer: 'a1', engine: 'ollama', model: 'm' });
  s.addReport('Brest', { mode: 'debrief', question: 'q2', answer: 'a2', engine: 'ollama', model: 'm' });
  const again = new Store(dir);
  assert.equal(again.reports('Lyon').length, 1); assert.equal(again.reports('Brest')[0].question, 'q2');
  assert.deepEqual(again.careers(), ['Brest', 'Lyon']);
  for (let i = 0; i < 30; i++) again.addReport('Lyon', { mode: 'x', question: 'q', answer: 'z'.repeat(5000), engine: 'e', model: 'm' });
  assert.ok(again.context('Lyon', 12000).length <= 12000);
});

test('changements testés : ajout, mise à jour, présence dans le contexte', () => {
  const s = new Store(tmp());
  const c = s.addChange('Lyon', { description: 'Passage en 4-2-3-1' });
  s.updateChange('Lyon', c.id, { after: '2V 1N sur 3 matchs', verdict: 'garder' });
  assert.match(s.context('Lyon'), /4-2-3-1.*2V 1N.*garder/);
  assert.equal(s.changes('Brest').length, 0);
});

test('discussion : messages conservés par carrière', () => {
  const s = new Store(tmp()); s.addMessage('Lyon', 'user', 'salut'); s.addMessage('Lyon', 'assistant', 'bonjour');
  assert.equal(s.messages('Lyon').length, 2); assert.equal(s.messages('Brest').length, 0);
});

test('modèle local adapté au matériel et prudent avec FM', () => {
  assert.equal(recommend({ ramGb: 16, vramGb: 8 }).model.tag, 'qwen3-vl:4b');
  assert.equal(recommend({ ramGb: 32, vramGb: 24 }).model.tag, 'qwen3-vl:8b');
  assert.equal(recommend({ ramGb: 16, vramGb: 4 }).model?.tag, 'qwen3-vl:2b');
  assert.equal(recommend({ ramGb: 8, vramGb: 2 }).model, null);
  assert.ok(recommend({ ramGb: 16, vramGb: null }).model.sizeGb <= 3.3);
});

const frame = (v, n = 48 * 27) => Uint8Array.from({ length: n }, () => v);
test('détection de changement : attend la stabilisation, ignore le bruit et les doublons', () => {
  const d = new ChangeDetector();
  assert.equal(d.push(frame(100)), false);
  assert.equal(d.push(frame(100)), true);   // premier écran stable
  assert.equal(d.push(frame(101)), false);  // bruit
  assert.equal(d.push(frame(200)), false);  // transition
  assert.equal(d.push(frame(201)), true);   // nouvel écran stable
  assert.equal(d.push(frame(201)), false);  // inchangé : pas de doublon
  assert.ok(distance(frame(0), frame(255)) > 0.99);
});

test('image noire détectée (plein écran exclusif)', () => {
  assert.ok(mostlyBlack(Buffer.alloc(64 * 36 * 4), 64, 36));
  assert.ok(!mostlyBlack(Buffer.alloc(64 * 36 * 4, 120), 64, 36));
});

test('reprise de l’ancien historique SQLite', (t) => {
  let DatabaseSync; try { ({ DatabaseSync } = require('node:sqlite')); } catch { return t.skip('node:sqlite indisponible'); }
  const legacy = tmp(); const db = new DatabaseSync(path.join(legacy, 'historique.sqlite'));
  db.exec('CREATE TABLE reports (id INTEGER PRIMARY KEY, career TEXT, created TEXT, question TEXT, answer TEXT)');
  db.prepare('INSERT INTO reports(career,created,question,answer) VALUES (?,?,?,?)').run('Lyon', '2026-01-01', 'Diagnostic tactique — mon 4-3-3 ?', 'réponse'); db.close();
  const s = new Store(tmp()); const flag = path.join(tmp(), 'flag');
  assert.equal(migrateLegacy(s, legacy, flag).migrated, 1);
  assert.equal(s.reports('Lyon')[0].question, 'mon 4-3-3 ?');
  assert.equal(migrateLegacy(s, legacy, flag).migrated, 0); // idempotent
});
