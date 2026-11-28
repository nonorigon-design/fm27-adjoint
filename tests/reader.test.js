'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { parseReading, buildReaderPrompt, similar, READER_SCHEMA } = require('../main/reader');
const { Store } = require('../main/store');

test('lecture : JSON entouré de texte, valeurs hors liste corrigées, conseils vides filtrés', () => {
  const r = parseReading('Voici : {"ecran":"Match en direct","titre_ecran":"Match","club":"Almería","faits":[{"sujet":"Gui (MC)","valeur":"note 5.9"}],"conseils":[{"priorite":"tres urgent","domaine":"??","titre":"Sortir Gui","action":"Remplace Gui par Junyent.","pourquoi":"5.9 à la 63e","ou":"Match > Remplacements"},{"titre":"","action":""}]} fin');
  assert.equal(r.ecran, 'Match en direct'); assert.equal(r.club, 'Almería');
  assert.equal(r.conseils.length, 1); assert.equal(r.conseils[0].priorite, 'important'); assert.equal(r.conseils[0].domaine, 'Match');
  assert.equal(parseReading('pas du json'), null);
  assert.deepEqual(parseReading('{"ecran":"Pas Football Manager","faits":[],"conseils":[{"titre":"x","action":"y"}]}').conseils, []);
});

test('prompt du lecteur : langue, contexte et interdiction des conseils vagues', () => {
  const p = buildReaderPrompt({ context: '- Effectif : Gui = 5.9', language: 'es' });
  assert.match(p, /Responde SOLO en español/); assert.match(p, /Gui = 5\.9/); assert.match(p, /INTERDIT : conseils vagues/);
  assert.deepEqual(READER_SCHEMA.required, ['ecran', 'titre_ecran', 'faits', 'conseils']);
});

test('dossier et consignes : pas de doublon, statut retenu, contexte pour la lecture suivante', () => {
  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'fm27-')));
  const c = { priorite: 'important', domaine: 'Match', titre: 'Sortir Gui, entrer Junyent', action: 'Remplace Gui par Quim Junyent au poste de MC.', pourquoi: 'Gui 5.9', ou: 'Match' };
  const reading = { ecran: 'Match en direct', titre_ecran: 'Match', club: '', faits: [{ sujet: 'Gui', valeur: '5.9' }], conseils: [c] };
  assert.equal(store.addReading('Almería', reading).length, 1);
  assert.equal(store.addReading('Almería', { ...reading, conseils: [{ ...c, titre: 'Sortir Gui pour Junyent', priorite: 'urgent' }] }).length, 0, 'même conseil reformulé');
  const b = store.board('Almería');
  assert.equal(b.conseils.length, 1); assert.equal(b.conseils[0].vu, 2); assert.equal(b.conseils[0].priorite, 'urgent');
  assert.equal(b.dossier['Match en direct'].faits[0].valeur, '5.9');
  store.setConseil('Almería', b.conseils[0].id, 'refuse');
  assert.match(store.readerContext('Almería'), /refusés par le joueur[^\n]*Sortir Gui/);
  assert.ok(!similar(c, { titre: 'Passer en 4-3-3', action: 'Change la formation en 4-3-3 avec deux ailiers.' }));
});
