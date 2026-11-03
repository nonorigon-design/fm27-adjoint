'use strict';
const { EventEmitter } = require('events');

/**
 * Mises à jour via GitHub Releases (electron-updater).
 * - Les fichiers sont vérifiés par empreinte SHA-512 (latest.yml) : un téléchargement incomplet ou altéré est rejeté.
 * - L'installation se fait à la fermeture ou au clic « Redémarrer », jamais sur des fichiers en cours d'utilisation.
 * - Sans Internet, l'application s'ouvre normalement : l'échec de vérification est silencieux au démarrage.
 */
class UpdateManager extends EventEmitter {
  constructor({ autoUpdater, currentVersion, packaged }) {
    super();
    this.au = autoUpdater;
    this.state = { state: 'idle', current: currentVersion, available: null, percent: 0, message: '', packaged };
    if (!packaged || !autoUpdater) return;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowDowngrade = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking', message: 'Recherche de mises à jour…' }));
    autoUpdater.on('update-available', (i) => this.set({ state: 'downloading', available: i.version, percent: 0, message: `Version ${i.version} disponible : téléchargement…` }));
    autoUpdater.on('update-not-available', () => this.set({ state: 'none', available: null, message: 'Tu utilises la dernière version.' }));
    autoUpdater.on('download-progress', (p) => this.set({ state: 'downloading', percent: Math.round(p.percent), message: `Téléchargement ${Math.round(p.percent)} %` }));
    autoUpdater.on('update-downloaded', (i) => this.set({ state: 'ready', available: i.version, percent: 100, message: `Version ${i.version} prête : redémarre pour l’installer.` }));
    autoUpdater.on('error', (e) => this.set({ state: 'error', message: friendly(e) }));
  }
  set(patch) { this.state = { ...this.state, ...patch }; this.emit('state', this.state); }
  async check({ silent = false } = {}) {
    if (!this.state.packaged || !this.au) { this.set({ state: 'dev', message: 'Mises à jour indisponibles en mode développement.' }); return this.state; }
    try { await this.au.checkForUpdates(); } catch (e) { this.set(silent ? { state: 'offline', message: 'Mise à jour non vérifiée (hors ligne ?). La version installée reste utilisable.' } : { state: 'error', message: friendly(e) }); }
    return this.state;
  }
  install() {
    if (this.state.state !== 'ready') return false;
    this.au.quitAndInstall(false, true); // installation silencieuse puis relance
    return true;
  }
}

function friendly(e) {
  const m = String(e?.message || e || '');
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ERR_INTERNET|ERR_NAME_NOT_RESOLVED|net::/i.test(m)) return 'Impossible de joindre GitHub : la version installée reste utilisable.';
  if (/sha512|checksum/i.test(m)) return 'Téléchargement corrompu ou incomplet : rejeté, la version installée est conservée.';
  if (/404|Cannot find latest/i.test(m)) return 'Aucune version publiée trouvée pour le moment.';
  return 'Mise à jour impossible : ' + m.slice(0, 160);
}

module.exports = { UpdateManager, friendly };
