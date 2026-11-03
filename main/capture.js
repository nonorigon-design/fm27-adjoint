'use strict';
const { desktopCapturer, nativeImage, screen } = require('electron');
const crypto = require('crypto');
const { signature, mostlyBlack } = require('./diff');

const FM_RE = /football manager|\bfm ?(20)?27\b/i;
const SELF_RE = /FM27 Adjoint/i;
const MAX_IMAGES = 6;

class CaptureError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/** Images conservées côté processus principal : le rendu ne manipule que des identifiants et des miniatures. */
class ImageBank {
  constructor() { this.map = new Map(); }
  add(img, label) {
    if (this.map.size >= MAX_IMAGES) throw new CaptureError('full', `Maximum ${MAX_IMAGES} captures : retire-en une avant d’en ajouter.`);
    const id = crypto.randomUUID();
    const size = img.getSize();
    const jpeg = img.resize(size.width > 2560 ? { width: 2560 } : {}).toJPEG(90);
    const thumb = img.resize({ width: 360 }).toDataURL();
    this.map.set(id, { jpeg, label, w: size.width, h: size.height, at: Date.now() });
    return { id, label, thumb, w: size.width, h: size.height };
  }
  remove(id) { this.map.delete(id); }
  clear() { this.map.clear(); }
  base64(ids) {
    return ids.map((id) => {
      const e = this.map.get(id);
      if (!e) throw new CaptureError('missing', 'Une capture sélectionnée n’existe plus. Ajoute-la à nouveau.');
      return e.jpeg.toString('base64');
    });
  }
  list() { return [...this.map.entries()].map(([id, e]) => ({ id, label: e.label, w: e.w, h: e.h })); }
}

async function listWindows() {
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1, height: 1 } });
  const rows = sources.filter((s) => s.name && !SELF_RE.test(s.name)).map((s) => ({ id: s.id, name: s.name, fm: FM_RE.test(s.name) }));
  return rows.sort((a, b) => (b.fm - a.fm) || a.name.localeCompare(b.name));
}

async function listScreens() {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay().id;
  return displays.map((d, i) => ({ id: String(d.id), name: `Écran ${i + 1}${d.id === primary ? ' (principal)' : ''} — ${d.size.width}×${d.size.height}`, primary: d.id === primary }));
}

function checkImage(img, what) {
  const size = img.getSize();
  if (img.isEmpty() || size.width < 100 || size.height < 100) {
    throw new CaptureError('minimized', `${what} semble réduite ou masquée : Windows ne fournit alors aucune image. Rouvre Football Manager (il peut rester derrière l’adjoint, mais pas réduit), ou importe une capture.`);
  }
  const small = img.resize({ width: 64, height: 36 });
  const s = small.getSize();
  if (mostlyBlack(small.toBitmap(), s.width, s.height)) {
    throw new CaptureError('black', `${what} apparaît toute noire. Cela arrive en plein écran exclusif : passe FM en « plein écran fenêtré » / sans bordure, ou utilise la capture d’écran entier, ou importe une capture.`);
  }
}

/**
 * Capture d'une fenêtre précise. Sous Windows, Electron utilise l'API de capture du système : la fenêtre peut
 * être partiellement recouverte par d'autres, mais PAS réduite dans la barre des tâches.
 */
async function grabWindow(id, size = { width: 3840, height: 2160 }) {
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: size });
  const src = sources.find((s) => s.id === id);
  if (!src) throw new CaptureError('gone', 'La fenêtre choisie n’existe plus. Actualise la liste des fenêtres.');
  checkImage(src.thumbnail, 'La fenêtre de Football Manager');
  return src.thumbnail;
}

/** Repli : capture d'un écran entier (utile en plein écran sans bordure ou si la capture de fenêtre échoue). */
async function grabScreen(displayId, size = { width: 3840, height: 2160 }) {
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
  const src = sources.find((s) => String(s.display_id) === String(displayId)) || sources[0];
  if (!src) throw new CaptureError('gone', 'Aucun écran disponible pour la capture.');
  checkImage(src.thumbnail, 'L’écran');
  return src.thumbnail;
}

/** Cherche automatiquement la fenêtre FM la mieux classée. */
async function findFm() {
  const win = (await listWindows()).find((w) => w.fm);
  return win || null;
}

async function smallSignature(grabber) {
  const img = await grabber({ width: 480, height: 270 });
  const small = img.resize({ width: 48, height: 27 });
  const s = small.getSize();
  return signature(small.toBitmap(), s.width, s.height);
}

function fromFile(buffer) {
  const img = nativeImage.createFromBuffer(buffer);
  if (img.isEmpty()) throw new CaptureError('bad_image', 'Ce fichier n’est pas une image lisible (PNG, JPEG, WebP).');
  return img;
}

module.exports = { ImageBank, CaptureError, listWindows, listScreens, grabWindow, grabScreen, findFm, smallSignature, fromFile, FM_RE, MAX_IMAGES };
