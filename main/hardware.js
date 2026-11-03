'use strict';
const os = require('os');
const { execFile } = require('child_process');

// Tailles : pages Ollama qwen3-vl (2b ≈ 1,9 Go ; 4b ≈ 3,3 Go ; 8b ≈ 6,1 Go), relevées en août 2026.
const MODELS = [
  { tag: 'qwen3-vl:2b', sizeGb: 1.9, minVramGb: 3, minRamGb: 8, note: 'Très léger, qualité limitée sur les petits textes.' },
  { tag: 'qwen3-vl:4b', sizeGb: 3.3, minVramGb: 6, minRamGb: 12, note: 'Compromis recommandé avec FM ouvert.' },
  { tag: 'qwen3-vl:8b', sizeGb: 6.1, minVramGb: 10, minRamGb: 24, note: 'Meilleure lecture des écrans, mais lourd si FM tourne en même temps.' },
];

/**
 * Choisit un modèle qui laisse de la marge à FM : on réserve de la VRAM/RAM au jeu.
 * Sans GPU dédié détecté, on reste sur le modèle le plus léger compatible avec la RAM.
 */
function recommend({ ramGb, vramGb }) {
  const fmReserveVram = 4; // FM + bureau
  const fmReserveRam = 8;
  const usableVram = vramGb == null ? 0 : Math.max(0, vramGb - fmReserveVram + 3);
  let pick = null;
  for (const m of MODELS) {
    const gpuOk = vramGb != null && usableVram >= m.minVramGb - 3 && vramGb >= m.minVramGb;
    const cpuOk = vramGb == null && ramGb - fmReserveRam >= m.sizeGb * 2.5;
    if (gpuOk || cpuOk) pick = m;
  }
  if (!pick) return { model: null, reason: 'Matériel trop juste pour un modèle de vision local confortable pendant une partie : utilise Gemini ou libère de la mémoire.' };
  const where = vramGb != null ? `${vramGb} Go de mémoire graphique` : `${ramGb} Go de RAM (sans carte graphique dédiée détectée : analyse plus lente)`;
  return { model: pick, reason: `Choisi pour ${where}, en laissant de la marge à Football Manager. ${pick.note}` };
}

function run(cmd, args, timeout = 5000) {
  return new Promise((resolve) => execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout) => resolve(err ? '' : String(stdout))));
}

async function detect() {
  const ramGb = Math.round((os.totalmem() / 1024 ** 3) * 10) / 10;
  let vramGb = null;
  let gpu = null;
  const smi = await run('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits']);
  const line = smi.split('\n').map((s) => s.trim()).find(Boolean);
  if (line) {
    const [name, mb] = line.split(',').map((s) => s.trim());
    const v = parseInt(mb, 10);
    if (v > 0) { vramGb = Math.round((v / 1024) * 10) / 10; gpu = name; }
  }
  if (vramGb == null && process.platform === 'win32') {
    // AdapterRAM est plafonné à 4 Go (32 bits) : on ne s'en sert que pour le nom du GPU.
    const out = await run('powershell.exe', ['-NoProfile', '-Command', '(Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name) -join "; "'], 8000);
    gpu = out.trim() || null;
  }
  return { ramGb, vramGb, gpu, cpus: os.cpus().length, ...recommend({ ramGb, vramGb }) };
}

module.exports = { MODELS, recommend, detect };
