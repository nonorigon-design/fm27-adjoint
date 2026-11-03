'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { normalizeKey, redact, validAccelerator, sanitizeCareer } = require('../main/util');
const { KeyStore } = require('../main/keystore');
const { createLogger } = require('../main/logger');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fm27-'));
const KEY = 'AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q';
// Faux safeStorage : "chiffre" en inversant les octets, pour vérifier qu'aucun clair n'est écrit.
const fakeSafe = (ok = true) => ({ isEncryptionAvailable: () => ok, encryptString: (s) => Buffer.from('ENC:' + [...s].reverse().join('')), decryptString: (b) => [...b.toString().slice(4)].reverse().join('') });

test('normalizeKey retire espaces, retours à la ligne et guillemets sans altérer la clé', () => {
  assert.equal(normalizeKey(`  "${KEY}"\r\n`), KEY);
  assert.equal(normalizeKey(KEY.slice(0, 10) + '\n ' + KEY.slice(10) + '​'), KEY);
  assert.equal(normalizeKey(null), '');
});

test('redact masque toute clé API, y compris dans une URL ou un en-tête', () => {
  assert.doesNotMatch(redact(`échec https://x/y?key=${KEY}&a=1`), /AIza/);
  assert.doesNotMatch(redact(`x-goog-api-key: ${KEY}`), /AIza/);
  assert.doesNotMatch(redact('autre secret ZZZZZZZZZZZZ', ['ZZZZZZZZZZZZ']), /ZZZZ/);
});

test('raccourcis : exige un modificateur et une touche valide', () => {
  assert.ok(validAccelerator('Control+Alt+A')); assert.ok(validAccelerator('Control+Shift+F9'));
  assert.ok(!validAccelerator('A')); assert.ok(!validAccelerator('Control')); assert.ok(!validAccelerator('Foo+A'));
});

test('sanitizeCareer', () => { assert.equal(sanitizeCareer('  '), 'Ma carrière'); assert.equal(sanitizeCareer('Lyon\u0000 2027'), 'Lyon 2027'); });

test('KeyStore : enregistre chiffré, restaure, oublie ; jamais en clair', () => {
  const dir = tmp(); const ks = new KeyStore(dir, fakeSafe());
  ks.save(`  ${KEY}\n`);
  assert.ok(ks.has());
  assert.ok(!fs.readFileSync(path.join(dir, 'gemini-key.bin')).toString().includes(KEY));
  assert.equal(new KeyStore(dir, fakeSafe()).load(), KEY); // « relancement »
  ks.forget(); assert.ok(!ks.has()); assert.equal(ks.load(), '');
});

test('KeyStore refuse de mémoriser sans chiffrement disponible', () => {
  const ks = new KeyStore(tmp(), fakeSafe(false));
  assert.throws(() => ks.save(KEY), /en clair/); assert.ok(!ks.has());
});

test('le journal ne contient jamais la clé', () => {
  const dir = tmp(); const log = createLogger(dir, () => ['secret-perso-123456']);
  log.error(`boom ${KEY} et secret-perso-123456`);
  const txt = fs.readFileSync(log.file, 'utf8');
  assert.doesNotMatch(txt, /AIza|secret-perso/);
});
