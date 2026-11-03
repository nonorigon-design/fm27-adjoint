"""Updates before launch; failure leaves the installed version usable."""
import base64
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
import urllib.request
from pathlib import Path

MANIFEST_URL = 'https://raw.githubusercontent.com/nonorigon-design/fm27-adjoint/main/update.json'
ALLOWED = {'app.py', 'core.py', 'capture.py'}
MAX_MANIFEST = 2_000_000


def install(manifest, root):
    if manifest.get('schema') != 1:
        raise ValueError('Format de mise a jour inconnu.')
    version = manifest.get('version', '')
    if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', version):
        raise ValueError('Version invalide.')
    files = manifest.get('files', {})
    if set(files) != ALLOWED:
        raise ValueError('Liste de fichiers invalide.')
    decoded = {}
    for name, entry in files.items():
        raw = base64.b64decode(entry['base64'], validate=True)
        if hashlib.sha256(raw).hexdigest() != entry['sha256']:
            raise ValueError('Verification du fichier impossible.')
        compile(raw, name, 'exec')
        decoded[name] = raw
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    # Content identity prevents partial updates and supports correcting the same version.
    identity = hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()[:20]
    target = root / (version + '-' + identity)
    if not target.exists():
        stage = Path(tempfile.mkdtemp(prefix='pending-', dir=root))
        try:
            for name, raw in decoded.items():
                (stage / name).write_bytes(raw)
            stage.rename(target)
        finally:
            if stage.exists():
                shutil.rmtree(stage)
    return target


def refresh(root):
    request = urllib.request.Request(MANIFEST_URL, headers={'User-Agent': 'FM27-Adjoint-Updater', 'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(request, timeout=12) as response:
        raw = response.read(MAX_MANIFEST + 1)
    if len(raw) > MAX_MANIFEST:
        raise ValueError('Mise a jour trop volumineuse.')
    return install(json.loads(raw), root)


def launch(base, data):
    import subprocess
    base, data = Path(base), Path(data)
    versions = data / 'versions'
    pointer = data / 'current.json'
    previous = None
    try:
        name = json.loads(pointer.read_text())['folder']
        if re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+-[a-f0-9]{20}', name):
            path = versions / name
            if (path / 'app.py').is_file():
                previous = path
    except (OSError, ValueError, KeyError, TypeError):
        pass
    selected = previous or base
    print('Verification des mises a jour...', flush=True)
    try:
        selected = refresh(versions)
        print('Application a jour.', flush=True)
    except Exception as error:
        print('Mise a jour indisponible. Ouverture de la version installee. (' + type(error).__name__ + ')', flush=True)
    result = subprocess.run([sys.executable, str(selected / 'app.py')], cwd=selected)
    if result.returncode and selected != (previous or base):
        print('Echec du lancement : retour a la version precedente.', flush=True)
        return subprocess.run([sys.executable, str((previous or base) / 'app.py')], cwd=previous or base).returncode
    if not result.returncode and selected != base:
        # Only promote a version after it has launched and closed successfully.
        temp = data / 'current.pending'
        temp.write_text(json.dumps({'folder': selected.name}))
        os.replace(temp, pointer)
    return result.returncode


if __name__ == '__main__':
    sys.exit(launch(Path(__file__).resolve().parent, Path(sys.argv[1])))
