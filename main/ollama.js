'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { ollamaFetch, OLLAMA } = require('./ai');
const { AiError } = require('./errors');

function binaryPath() {
  const local = process.env.LOCALAPPDATA;
  const candidates = [local && path.join(local, 'Programs', 'Ollama', 'ollama.exe'), 'C:\\Program Files\\Ollama\\ollama.exe'].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || null;
}

/** État : installé ? serveur lancé ? modèles présents ? */
async function status(fetchImpl = fetch) {
  const bin = binaryPath();
  try {
    const res = await ollamaFetch('/api/tags', { fetchImpl });
    const data = await res.json();
    return { installed: true, running: true, models: (data.models || []).map((m) => ({ name: m.name, sizeGb: Math.round((m.size / 1024 ** 3) * 10) / 10 })) };
  } catch (e) {
    if (e instanceof AiError && e.kind === 'ollama_down') return { installed: !!bin, running: false, models: [] };
    throw e;
  }
}

async function start(fetchImpl = fetch) {
  const bin = binaryPath();
  if (!bin) throw new AiError('ollama_down', 'Ollama n’est pas installé.');
  const child = spawn(bin, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const s = await status(fetchImpl).catch(() => null);
    if (s?.running) return s;
  }
  throw new AiError('ollama_down', 'Ollama ne répond pas après son démarrage.');
}

/** Installation via winget, uniquement sur clic de l'utilisateur. */
function installWithWinget() {
  return new Promise((resolve, reject) => {
    execFile('winget.exe', ['install', '--id', 'Ollama.Ollama', '--exact', '--source', 'winget', '--scope', 'user', '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'], { windowsHide: true, timeout: 15 * 60 * 1000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(err.code === 'ENOENT' ? 'winget est introuvable : installe Ollama depuis ollama.com/download.' : 'L’installation d’Ollama a échoué : ' + String(stderr || err.message).slice(0, 200)));
      else resolve(true);
    });
  });
}

/** Parse un flux NDJSON d'/api/pull et agrège la progression de toutes les couches. */
function createPullTracker() {
  const layers = new Map();
  return (line) => {
    let j;
    try { j = JSON.parse(line); } catch { return null; }
    if (j.error) return { error: String(j.error) };
    if (j.digest && j.total) layers.set(j.digest, { total: j.total, done: j.completed || 0 });
    let total = 0, done = 0;
    for (const l of layers.values()) { total += l.total; done += l.done; }
    return { status: j.status || '', total, done, percent: total ? Math.min(100, Math.round((done / total) * 100)) : null };
  };
}

/** Télécharge un modèle. Si interrompu, relancer reprend les couches déjà reçues (comportement d'Ollama). */
async function pull(model, onProgress, signal, fetchImpl = fetch) {
  const res = await ollamaFetch('/api/pull', { body: { model, stream: true }, signal, fetchImpl });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const track = createPullTracker();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      const p = track(line);
      if (p?.error) throw new AiError('server', 'Téléchargement impossible : ' + p.error.slice(0, 200));
      if (p) onProgress(p);
    }
  }
  return true;
}

const INSTALLER_URL = 'https://ollama.com/download/OllamaSetup.exe';

/** Télécharge l'installateur officiel, avec reprise (Range) si un téléchargement partiel existe. */
async function downloadInstaller(dest, onProgress, signal, fetchImpl = fetch) {
  let have = 0;
  try { have = fs.statSync(dest).size; } catch { /* nouveau */ }
  let res = await fetchImpl(INSTALLER_URL, { signal, headers: have ? { Range: `bytes=${have}-` } : {} });
  if (res.status === 416) { try { fs.unlinkSync(dest); } catch { /* ignoré */ } have = 0; res = await fetchImpl(INSTALLER_URL, { signal }); }
  if (!res.ok) throw new AiError('connection', `Téléchargement d’Ollama impossible (HTTP ${res.status}).`);
  const resumed = res.status === 206;
  if (!resumed) have = 0;
  const total = have + Number(res.headers.get('content-length') || 0);
  const out = fs.createWriteStream(dest, { flags: resumed ? 'a' : 'w' });
  const reader = res.body.getReader();
  let done = have;
  try {
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      if (!out.write(value)) await new Promise((r) => out.once('drain', r));
      done += value.length;
      onProgress({ done, total, percent: total ? Math.round((done / total) * 100) : null });
    }
  } finally { await new Promise((r) => out.end(r)); }
  if (total && done < total) throw new AiError('connection', 'Téléchargement incomplet : relance pour le reprendre.');
  return dest;
}

/** Exige une signature Authenticode valide dont le signataire contient « Ollama » ; sinon on n'exécute rien. */
function verifySignature(file) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-Command', `$s=Get-AuthenticodeSignature -LiteralPath '${file.replace(/'/g, "''")}'; @{status=[string]$s.Status; subject=[string]$s.SignerCertificate.Subject} | ConvertTo-Json -Compress`], { windowsHide: true, timeout: 60000 }, (err, stdout) => {
      if (err) return reject(new Error('Vérification de la signature impossible.'));
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error('Vérification de la signature illisible.')); }
    });
  });
}

function runSilent(file) {
  return new Promise((resolve, reject) => {
    execFile(file, ['/SP-', '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], { windowsHide: true, timeout: 20 * 60 * 1000 }, (err) => (err ? reject(new Error('L’installation d’Ollama a échoué : ' + String(err.message).slice(0, 160))) : resolve(true)));
  });
}

module.exports = { status, start, installWithWinget, pull, createPullTracker, binaryPath, downloadInstaller, verifySignature, runSilent, INSTALLER_URL, OLLAMA };
