"""Run tests first, then python build_update.py VERSION before publishing a correction."""
import base64
import hashlib
import json
import re
import sys
from pathlib import Path
root=Path(__file__).resolve().parent
version=sys.argv[1]
if not re.fullmatch(r'\d+\.\d+\.\d+',version):
    raise ValueError('Version attendue : x.y.z')
files={}
for name in ['app.py','core.py','capture.py']:
    raw=(root/name).read_bytes()
    compile(raw,name,'exec')
    files[name]={'base64':base64.b64encode(raw).decode(),'sha256':hashlib.sha256(raw).hexdigest()}
(root/'update.json').write_text(json.dumps({'schema':1,'version':version,'files':files},indent=2),encoding='utf-8')
