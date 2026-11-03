'use strict';
// Détection de changement d'écran, pure et testable : signature en niveaux de gris réduite, puis écart moyen 0..1.

/** bgra = Buffer BGRA (nativeImage.toBitmap) de taille w×h déjà réduite. */
function signature(bgra, w, h) {
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const b = bgra[i * 4], g = bgra[i * 4 + 1], r = bgra[i * 4 + 2];
    out[i] = (r * 299 + g * 587 + b * 114) / 1000;
  }
  return out;
}
function distance(a, b) {
  if (!a || !b || a.length !== b.length) return 1;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length / 255;
}
/** Image quasi noire : capture d'un plein écran exclusif ou d'une fenêtre non rendue. */
function mostlyBlack(bgra, w, h) {
  const n = w * h; if (!n) return true;
  let dark = 0;
  for (let i = 0; i < n; i += 7) { if (bgra[i * 4] < 8 && bgra[i * 4 + 1] < 8 && bgra[i * 4 + 2] < 8) dark++; }
  return dark / Math.ceil(n / 7) > 0.985;
}

/**
 * Machine à états : un écran "change" quand il bouge, puis on attend qu'il se stabilise (2 relevés proches)
 * et qu'il diffère assez de la dernière capture signalée. Évite les analyses inutiles pendant les animations.
 */
class ChangeDetector {
  constructor({ moveThreshold = 0.035, settleThreshold = 0.012, novelty = 0.05 } = {}) {
    Object.assign(this, { moveThreshold, settleThreshold, novelty });
    this.prev = null; this.reported = null; this.moving = false;
  }
  /** Retourne true quand un nouvel écran stable vient d'apparaître. */
  push(sig) {
    let fire = false;
    if (this.prev) {
      const d = distance(this.prev, sig);
      if (d > this.moveThreshold) this.moving = true;
      else if (d < this.settleThreshold && (this.moving || !this.reported)) {
        if (!this.reported || distance(this.reported, sig) > this.novelty) { this.reported = sig; fire = true; }
        this.moving = false;
      }
    }
    this.prev = sig;
    return fire;
  }
  reset() { this.prev = null; this.reported = null; this.moving = false; }
}

module.exports = { signature, distance, mostlyBlack, ChangeDetector };
