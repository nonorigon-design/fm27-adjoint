'use strict';
const { app, BrowserWindow, ipcMain, globalShortcut, dialog, shell, safeStorage, Menu, session } = require('electron');
const path = require('path');
const fs = require('fs');

// Les variables NODE_OPTIONS héritées d'un terminal peuvent perturber Electron.
delete process.env.NODE_OPTIONS;

const { createLogger } = require('./logger');
const { KeyStore } = require('./keystore');
const { Store } = require('./store');
const { UpdateManager } = require('./updater');
const { analyze, geminiModels } = require('./ai');
const { AiError } = require('./errors');
const { validAccelerator, sanitizeCareer, normalizeKey, redact } = require('./util');
const { MODES } = require('./prompts');
const { migrateLegacy } = require('./legacy');
const hardware = require('./hardware');
const ollama = require('./ollama');
const cap = require('./capture');
const { ChangeDetector } = require('./diff');

const DEFAULTS = { provider: 'ollama', geminiModel: '', ollamaModel: '', shortcut: 'Control+Alt+A', career: 'Ma carrière', bounds: null, section: 'tactique' };
const ALLOWED_HOSTS = new Set(['ollama.com', 'aistudio.google.com', 'ai.google.dev', 'github.com', 'console.cloud.google.com']);

// Données isolées pour les tests automatisés (jamais utilisé en usage normal).
if (process.env.FM27_USERDATA) app.setPath('userData', process.env.FM27_USERDATA);

if (!process.env.FM27_SMOKE && !app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

let win = null;
let geminiKey = '';
let settings = { ...DEFAULTS };
let keystore, store, logger, updater, bank;
let currentAbort = null;
let pullAbort = null;
let watchTimer = null;
let detector = new ChangeDetector();
let fmWindowId = null;

const dataDir = () => app.getPath('userData');
const settingsFile = () => path.join(dataDir(), 'settings.json');

function loadSettings() {
  try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch { settings = { ...DEFAULTS }; }
}
function saveSettings() {
  const tmp = settingsFile() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 1));
  fs.renameSync(tmp, settingsFile());
}

/** Enveloppe uniforme : jamais d'exception brute vers le rendu, et messages débarrassés de toute clé. */
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!win || event.sender !== win.webContents) return { ok: false, error: { kind: 'forbidden', message: 'Appel refusé.' } };
    try { return { ok: true, data: await fn(...args) }; } catch (e) {
      const message = redact(String(e?.message || e), [geminiKey]);
      logger?.warn(`${channel} : ${message}`);
      return { ok: false, error: { kind: e?.kind || e?.code || 'error', message, retryAfter: e?.retryAfter ?? null } };
    }
  });
}

function send(channel, payload) { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); }

function createWindow() {
  const b = settings.bounds;
  win = new BrowserWindow({
    width: b?.width || 1360, height: b?.height || 860, x: b?.x, y: b?.y, minWidth: 1000, minHeight: 680,
    backgroundColor: '#0b1b2e', show: false, title: 'FM27 Adjoint', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.on('did-finish-load', () => markBootOk());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('close', () => { if (!win.isMinimized() && !win.isMaximized()) { settings.bounds = win.getBounds(); try { saveSettings(); } catch { /* ignoré */ } } });
  win.on('closed', () => { win = null; });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

// ---- Suivi de santé du démarrage : permet de signaler un lancement qui n'a pas abouti. ----
function bootFile() { return path.join(dataDir(), 'boot.json'); }
function markBootStart() {
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(bootFile(), 'utf8')); } catch { /* premier lancement */ }
  const failedPrevious = !!prev && prev.version === app.getVersion() && prev.ready === false;
  fs.writeFileSync(bootFile(), JSON.stringify({ version: app.getVersion(), ready: false, at: Date.now(), failures: failedPrevious ? (prev.failures || 0) + 1 : 0 }));
  return failedPrevious;
}
function markBootOk() {
  try { const b = JSON.parse(fs.readFileSync(bootFile(), 'utf8')); b.ready = true; b.failures = 0; fs.writeFileSync(bootFile(), JSON.stringify(b)); } catch { /* ignoré */ }
}

// ---- Raccourci global ----
function registerShortcut(acc) {
  globalShortcut.unregisterAll();
  if (!acc) return true;
  if (!validAccelerator(acc)) throw new Error('Raccourci invalide : utilise au moins Ctrl, Alt ou Maj plus une touche.');
  const ok = globalShortcut.register(acc, () => { captureFm({ fromShortcut: true }).catch(() => {}); });
  if (!ok) throw new Error('Ce raccourci est déjà utilisé par un autre programme. Choisis-en un autre.');
  return true;
}

async function captureFm({ fromShortcut = false } = {}) {
  try {
    let target = fmWindowId ? (await cap.listWindows()).find((w) => w.id === fmWindowId) : null;
    if (!target) target = await cap.findFm();
    if (!target) throw new cap.CaptureError('nofm', 'Fenêtre Football Manager introuvable. Lance le jeu (en fenêtré ou plein écran fenêtré) puis réessaie, ou choisis une fenêtre dans la liste.');
    fmWindowId = target.id;
    const img = await cap.grabWindow(target.id);
    const item = bank.add(img, target.name);
    if (fromShortcut) send('capture:added', item);
    return item;
  } catch (e) {
    if (fromShortcut) send('capture:error', { message: e.message, code: e.code });
    throw e;
  }
}

// ---- Surveillance : détecte les changements d'écran, ne capture que localement, n'envoie jamais rien. ----
async function watchTick() {
  try {
    if (!fmWindowId) { const f = await cap.findFm(); fmWindowId = f?.id || null; if (!fmWindowId) return; }
    const sig = await cap.smallSignature((size) => cap.grabWindow(fmWindowId, size));
    if (detector.push(sig)) {
      const img = await cap.grabWindow(fmWindowId);
      send('watch:changed', { thumb: img.resize({ width: 360 }).toDataURL(), at: Date.now() });
      pendingWatchImage = img;
    }
  } catch (e) {
    if (e.code === 'gone' || e.code === 'nofm') fmWindowId = null;
    send('watch:changed', { error: e.message, code: e.code });
  }
}
let pendingWatchImage = null;

function setWatch(on) {
  if (watchTimer) { clearInterval(watchTimer); watchTimer = null; }
  detector = new ChangeDetector();
  if (on) watchTimer = setInterval(() => watchTick(), 2500);
  return !!on;
}

// ---- IPC ----
function registerIpc() {
  handle('app:info', () => ({ version: app.getVersion(), packaged: app.isPackaged, encryption: keystore.available(), failedPreviousBoot, modes: Object.fromEntries(Object.entries(MODES).map(([k, v]) => [k, { label: v.label, placeholder: v.placeholder }])), platform: process.platform }));
  handle('settings:get', () => settings);
  handle('settings:set', (patch) => {
    const next = { ...settings };
    if (['ollama', 'gemini'].includes(patch.provider)) next.provider = patch.provider;
    for (const k of ['geminiModel', 'ollamaModel']) if (typeof patch[k] === 'string' && /^[A-Za-z0-9_.:\-\/]{0,80}$/.test(patch[k])) next[k] = patch[k];
    if (typeof patch.career === 'string') next.career = sanitizeCareer(patch.career);
    if (typeof patch.section === 'string' && MODES[patch.section]) next.section = patch.section;
    if (typeof patch.shortcut === 'string' && patch.shortcut !== settings.shortcut) { registerShortcut(patch.shortcut); next.shortcut = patch.shortcut; }
    settings = next; saveSettings(); return settings;
  });

  handle('key:status', () => ({ has: !!geminiKey, tail: geminiKey ? geminiKey.slice(-4) : '', encryption: keystore.available() }));
  // Validation PUIS enregistrement : une clé refusée n'est jamais mémorisée.
  handle('key:saveValidated', async (raw) => {
    const key = normalizeKey(raw);
    const list = await geminiModels(key);
    keystore.save(key); geminiKey = key;
    return { models: list.models, default: list.default, tail: key.slice(-4) };
  });
  handle('key:forget', () => { keystore.forget(); geminiKey = ''; return true; });
  handle('gemini:models', () => geminiModels(geminiKey));

  handle('ollama:status', () => ollama.status());
  handle('ollama:start', () => ollama.start());
  handle('ollama:install', () => ollama.installWithWinget());
  handle('ollama:pull', async (model) => {
    if (!/^[A-Za-z0-9_.:\-\/]+$/.test(model || '')) throw new Error('Nom de modèle invalide.');
    pullAbort = new AbortController();
    try { await ollama.pull(model, (p) => send('ollama:progress', { model, ...p }), pullAbort.signal); } finally { pullAbort = null; }
    return true;
  });
  handle('ollama:cancelPull', () => { pullAbort?.abort(); return true; });
  handle('hardware:detect', () => hardware.detect());

  handle('capture:windows', () => cap.listWindows());
  handle('capture:screens', () => cap.listScreens());
  handle('capture:fm', () => captureFm());
  handle('capture:window', async (id) => {
    if (typeof id !== 'string') throw new Error('Fenêtre invalide.');
    fmWindowId = id;
    const w = (await cap.listWindows()).find((x) => x.id === id);
    return bank.add(await cap.grabWindow(id), w?.name || 'Fenêtre');
  });
  handle('capture:screen', async (id) => bank.add(await cap.grabScreen(String(id)), 'Écran entier'));
  handle('capture:import', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Importer des captures', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    const out = [];
    for (const f of r.filePaths || []) {
      if (fs.statSync(f).size > 40 * 1024 * 1024) throw new Error(`${path.basename(f)} dépasse 40 Mo.`);
      out.push(bank.add(cap.fromFile(fs.readFileSync(f)), path.basename(f)));
    }
    return out;
  });
  handle('capture:remove', (id) => { bank.remove(id); return true; });
  handle('capture:clear', () => { bank.clear(); return true; });
  handle('watch:set', (on) => setWatch(!!on));
  // La capture repérée par la surveillance est ajoutée seulement sur clic.
  handle('watch:adopt', () => { if (!pendingWatchImage) throw new Error('Aucune capture en attente.'); const it = bank.add(pendingWatchImage, 'Écran détecté'); pendingWatchImage = null; return it; });
  handle('shortcut:set', (acc) => { registerShortcut(acc); settings.shortcut = acc; saveSettings(); return acc; });

  handle('analyze:run', async ({ mode, question, imageIds = [], career }) => {
    if (!MODES[mode]) throw new Error('Section inconnue.');
    const q = String(question || '').trim().slice(0, 6000);
    if (!q) throw new Error('Écris d’abord ta question.');
    if (!Array.isArray(imageIds) || imageIds.length > cap.MAX_IMAGES) throw new Error('Sélection de captures invalide.');
    if (mode !== 'discussion' && !imageIds.length) throw new Error('Ajoute au moins une capture : l’adjoint ne devine jamais un écran qu’il ne voit pas.');
    const name = sanitizeCareer(career || settings.career);
    const provider = settings.provider;
    const model = provider === 'ollama' ? settings.ollamaModel : settings.geminiModel;
    if (!model) throw new AiError('model_missing', 'Choisis un modèle dans les réglages IA.');
    currentAbort = new AbortController();
    try {
      const history = mode === 'discussion' ? store.messages(name).slice(-10) : [];
      const answer = await analyze({ provider, key: geminiKey, model, mode, question: q, context: store.context(name), history, images: bank.base64(imageIds), signal: currentAbort.signal });
      if (mode === 'discussion') { store.addMessage(name, 'user', q); store.addMessage(name, 'assistant', answer); }
      return store.addReport(name, { mode, question: q, answer, engine: provider, model, images: imageIds.length });
    } finally { currentAbort = null; }
  });
  handle('analyze:cancel', () => { currentAbort?.abort(); return true; });

  handle('history:careers', () => store.careers());
  handle('history:reports', (c) => store.reports(sanitizeCareer(c)));
  handle('history:messages', (c) => store.messages(sanitizeCareer(c)));
  handle('history:changes', (c) => store.changes(sanitizeCareer(c)));
  handle('history:addChange', (c, ch) => { if (!String(ch?.description || '').trim()) throw new Error('Décris le changement testé.'); return store.addChange(sanitizeCareer(c), ch); });
  handle('history:updateChange', (c, id, patch) => store.updateChange(sanitizeCareer(c), String(id), patch || {}));

  handle('report:export', async (text, career) => {
    const r = await dialog.showSaveDialog(win, { title: 'Exporter le rapport', defaultPath: 'Rapport_FM27.md', filters: [{ name: 'Texte Markdown', extensions: ['md', 'txt'] }] });
    if (r.canceled || !r.filePath) return false;
    fs.writeFileSync(r.filePath, `# ${sanitizeCareer(career)}\n\n${String(text || '')}`, 'utf8');
    return true;
  });

  handle('update:check', () => updater.check());
  handle('update:install', () => updater.install());
  handle('update:state', () => updater.state);
  handle('app:openExternal', (url) => {
    const u = new URL(String(url));
    if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname)) throw new Error('Lien non autorisé.');
    return shell.openExternal(u.href);
  });
  handle('app:openLogs', () => shell.showItemInFolder(logger.file));
}

let failedPreviousBoot = false;

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  Menu.setApplicationMenu(null);
  loadSettings();
  keystore = new KeyStore(dataDir(), safeStorage);
  geminiKey = keystore.load();
  logger = createLogger(path.join(dataDir(), 'logs'), () => [geminiKey]);
  store = new Store(dataDir());
  bank = new cap.ImageBank();
  failedPreviousBoot = markBootStart();
  if (failedPreviousBoot) logger.warn('Le démarrage précédent de cette version n’a pas abouti.');
  try {
    const m = migrateLegacy(store, path.join(process.env.LOCALAPPDATA || '', 'FM27_Adjoint'), path.join(dataDir(), 'legacy-migrated.flag'));
    if (m.migrated) logger.info(`Historique repris de l’ancienne version : ${m.migrated} rapport(s).`);
  } catch (e) { logger.warn('Reprise de l’ancien historique impossible : ' + e.message); }

  let autoUpdater = null;
  if (app.isPackaged) { try { ({ autoUpdater } = require('electron-updater')); autoUpdater.logger = { info: (m) => logger.info(String(m)), warn: (m) => logger.warn(String(m)), error: (m) => logger.error(String(m)), debug() {} }; } catch (e) { logger.error('electron-updater : ' + e.message); } }
  updater = new UpdateManager({ autoUpdater, currentVersion: app.getVersion(), packaged: app.isPackaged });
  updater.on('state', (s) => send('update:state', s));

  registerIpc();
  try { registerShortcut(settings.shortcut); } catch (e) { logger.warn('Raccourci non enregistré : ' + e.message); }
  createWindow();
  win.webContents.once('did-finish-load', () => {
    if (process.env.FM27_SMOKE) return runSmoke();
    setTimeout(() => updater.check({ silent: true }), 3000);
  });
});

/** Test de fumée : vérifie que l'interface se charge réellement (utilisé en CI sur l'exécutable Windows installé). */
async function runSmoke() {
  const out = { ok: false, version: app.getVersion(), packaged: app.isPackaged, platform: process.platform };
  try {
    await new Promise((r) => setTimeout(r, 2500));
    out.dom = await win.webContents.executeJavaScript(`({ title: document.getElementById('title').textContent, nav: document.querySelectorAll('#nav button').length, ver: document.getElementById('ver').textContent, engine: document.getElementById('engine-pill').textContent })`);
    out.encryption = keystore.available();
    // Aller-retour réel de la clé avec le chiffrement du système (DPAPI sous Windows), avec une clé factice.
    try { const probe = 'AIzaSmokeTestSmokeTestSmokeTest0000000'; keystore.save(probe); out.keyRoundTrip = keystore.load() === probe; keystore.forget(); } catch (e) { out.keyRoundTrip = false; out.keyError = String(e.message || e); }
    // Sonde de capture (informative) : prouve ce que Windows fournit réellement sur cette machine.
    out.capture = { windows: null, screens: null, screenGrab: null };
    try { out.capture.windows = (await cap.listWindows()).length; out.capture.screens = (await cap.listScreens()).length; } catch (e) { out.capture.error = String(e.message || e); }
    try { const sc = (await cap.listScreens())[0]; await cap.grabScreen(sc.id); out.capture.screenGrab = 'ok'; } catch (e) { out.capture.screenGrab = e.code || String(e.message || e).slice(0, 80); }
    out.ok = out.dom.nav === 6 && out.dom.ver === app.getVersion() && out.dom.title.length > 3 && (process.platform !== 'win32' || out.keyRoundTrip === true);
    if (process.env.FM27_SMOKE_SHOTS) { // captures d'écran supplémentaires (revue visuelle de l'interface)
      const dir = process.env.FM27_SMOKE_SHOTS; const snap = async (n) => fs.writeFileSync(path.join(dir, n), (await win.webContents.capturePage()).toPNG());
      await win.webContents.executeJavaScript(`document.getElementById('report').replaceChildren(Markdown.render(document, ${JSON.stringify('## Faits lus\n- **Formation** : 4-2-3-1 (Capture A)\n- **Milieu axial gauche** : rôle lu à l\u2019écran\n\n## Incertain ou illisible\n- Les consignes sans ballon ne sont pas visibles.\n\n## Diagnostic et hypothèses\nHypothèse : le milieu manque de soutien (à vérifier sur plusieurs matchs).\n\n## Corrections\n1. **Problème observé** : peu de couverture dans le couloir.\n2. **Éléments** : voir Capture A.\n3. **Changement conseillé** : demander à l\u2019ailier de rester plus bas.\n\n## Écrans à fournir ensuite\n- Page des consignes avec ballon.')}))`);
      await snap('report.png');
      await win.webContents.executeJavaScript(`document.getElementById('engine-pill').click()`); await new Promise((r) => setTimeout(r, 2500)); await snap('settings-local.png');
      await win.webContents.executeJavaScript(`document.querySelectorAll('.seg button')[1].click()`); await new Promise((r) => setTimeout(r, 1500)); await snap('settings-gemini.png');
    }
    if (process.env.FM27_SMOKE_PNG) fs.writeFileSync(process.env.FM27_SMOKE_PNG, (await win.webContents.capturePage()).toPNG());
  } catch (e) { out.error = String(e); }
  if (process.env.FM27_SMOKE_JSON) fs.writeFileSync(process.env.FM27_SMOKE_JSON, JSON.stringify(out, null, 1));
  app.exit(out.ok ? 0 : 1);
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('will-quit', () => { globalShortcut.unregisterAll(); if (watchTimer) clearInterval(watchTimer); });
app.on('window-all-closed', () => app.quit());
