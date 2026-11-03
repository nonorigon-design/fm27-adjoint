'use strict';

/**
 * Coach en direct : reçoit les écrans stables détectés, n'en analyse qu'un à la fois, respecte un délai minimum,
 * ne garde que le plus récent si le moteur est occupé, évite les répétitions et s'arrête seul en cas d'erreurs répétées.
 * Aucune dépendance Electron : testable avec une horloge et un moteur factices.
 */
class LiveCoach {
  constructor({ analyze, emit, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, minIntervalMs = 15000, maxErrors = 3, keep = 6 }) {
    Object.assign(this, { analyzeFn: analyze, emit, now, setTimer, clearTimer, minIntervalMs, maxErrors, keep });
    this.on = false; this.busy = false; this.pending = null; this.timer = null; this.lastStart = -Infinity;
    this.errors = 0; this.previous = []; this.seq = 0;
  }
  start() { this.on = true; this.errors = 0; this.emit({ type: 'state', on: true }); }
  stop(reason) {
    this.on = false; this.pending = null;
    if (this.timer) { this.clearTimer(this.timer); this.timer = null; }
    this.emit({ type: 'state', on: false, reason: reason || null });
  }
  /** payload : { jpeg, thumb } — l'écran vient d'être détecté comme nouveau et stable. */
  onScreen(payload) {
    if (!this.on) return;
    this.pending = payload;
    this._pump();
  }
  _pump() {
    if (!this.on || this.busy || !this.pending || this.timer) return;
    const wait = this.minIntervalMs - (this.now() - this.lastStart);
    if (wait > 0) { this.timer = this.setTimer(() => { this.timer = null; this._pump(); }, wait); return; }
    const payload = this.pending; this.pending = null;
    this.busy = true; this.lastStart = this.now();
    const id = ++this.seq;
    this.emit({ type: 'item', id, state: 'analyzing', thumb: payload.thumb, at: this.now() });
    Promise.resolve(this.analyzeFn(payload, this.previous.slice(-this.keep)))
      .then((text) => {
        this.errors = 0;
        const answer = String(text || '').trim();
        if (!answer || /^RAS\b/i.test(answer)) { this.emit({ type: 'item', id, state: 'quiet', thumb: payload.thumb, at: this.now() }); return; }
        this.previous.push(answer);
        this.previous = this.previous.slice(-this.keep);
        this.emit({ type: 'item', id, state: 'done', answer, thumb: payload.thumb, at: this.now() });
      })
      .catch((e) => {
        this.errors++;
        this.emit({ type: 'item', id, state: 'error', error: { kind: e?.kind || 'error', message: String(e?.message || e) }, thumb: payload.thumb, at: this.now() });
        // Quota ou accès : inutile d'insister. Sinon on s'arrête après plusieurs échecs d'affilée.
        if (e?.kind === 'quota' || e?.kind === 'invalid_key' || e?.kind === 'forbidden') this.stop(e.kind);
        else if (this.errors >= this.maxErrors) this.stop('errors');
      })
      .finally(() => { this.busy = false; this._pump(); });
  }
}

module.exports = { LiveCoach };
