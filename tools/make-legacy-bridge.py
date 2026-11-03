"""Génère update.json (schéma 1) lu par les anciens lanceurs : il redirige vers l'installateur de la nouvelle application.

Usage : python tools/make-legacy-bridge.py VERSION CHEMIN_INSTALLATEUR [SORTIE]
"""
import base64
import hashlib
import json
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parent
version, installer = sys.argv[1], Path(sys.argv[2])
out = Path(sys.argv[3]) if len(sys.argv) > 3 else root.parent / 'update.json'
if not re.fullmatch(r'\d+\.\d+\.\d+', version):
    raise SystemExit('Version attendue : x.y.z')
sha = hashlib.sha256(installer.read_bytes()).hexdigest()
url = f'https://github.com/nonorigon-design/fm27-adjoint/releases/download/v{version}/{installer.name}'
shim = (root / 'legacy-bridge-app.py').read_text(encoding='utf-8').replace('@VERSION@', version).replace('@URL@', url).replace('@SHA256@', sha)
stubs = {'core.py': '# Migre vers la nouvelle application Windows (voir app.py).\n', 'capture.py': '# Migre vers la nouvelle application Windows (voir app.py).\n'}
files = {'app.py': shim, **stubs}
manifest = {'schema': 1, 'version': version, 'files': {}}
for name, text in files.items():
    raw = text.encode('utf-8')
    compile(raw, name, 'exec')
    manifest['files'][name] = {'base64': base64.b64encode(raw).decode(), 'sha256': hashlib.sha256(raw).hexdigest()}
out.write_text(json.dumps(manifest, indent=2), encoding='utf-8')
print(f'{out} : pont vers {url}')
