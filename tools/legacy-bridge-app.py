"""Pont de migration : exécuté par l'ANCIEN lanceur Python (versions 1.x) à la place de app.py.

Il installe la nouvelle application Windows (installateur officiel du dépôt, empreinte SHA-256 vérifiée),
puis la lance. Il est idempotent : si la nouvelle application est déjà installée à la bonne version,
il se contente de la lancer. Bibliothèque standard uniquement.
"""
import hashlib
import os
import subprocess
import sys
import tempfile
import urllib.request

VERSION = '@VERSION@'
URL = '@URL@'
SHA256 = '@SHA256@'
EXE_NAME = 'FM27 Adjoint.exe'


def installed_exe():
    local = os.environ.get('LOCALAPPDATA', '')
    for folder in ('FM27 Adjoint', 'fm27-adjoint'):
        path = os.path.join(local, 'Programs', folder, EXE_NAME)
        if os.path.isfile(path):
            return path
    return None


def installed_version(exe):
    marker = os.path.join(os.path.dirname(exe), 'resources', 'app-update.yml')
    return marker if os.path.isfile(marker) else None


def launch(path, *args):
    flags = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    subprocess.Popen([path, *args], creationflags=flags, close_fds=True,
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def download(url, dest):
    request = urllib.request.Request(url, headers={'User-Agent': 'FM27-Adjoint-Migration', 'Cache-Control': 'no-cache'})
    digest = hashlib.sha256()
    with urllib.request.urlopen(request, timeout=60) as response, open(dest, 'wb') as out:
        while True:
            block = response.read(1 << 20)
            if not block:
                break
            digest.update(block)
            out.write(block)
    return digest.hexdigest()


def main():
    exe = installed_exe()
    if exe and installed_version(exe):
        print('FM27 Adjoint est deja installe : ouverture.', flush=True)
        launch(exe)
        return 0
    print('Installation de la nouvelle version de FM27 Adjoint (' + VERSION + ')...', flush=True)
    target = os.path.join(tempfile.mkdtemp(prefix='fm27-'), 'FM27-Adjoint-Setup.exe')
    try:
        got = download(URL, target)
    except Exception as error:
        print('Telechargement impossible (' + type(error).__name__ + '). Reessaie avec Internet.', flush=True)
        return 1
    if got.lower() != SHA256.lower():
        os.remove(target)
        print('Fichier incomplet ou altere : installation annulee.', flush=True)
        return 1
    # L'installateur affiche sa propre progression, installe pour ce compte, remplace l'ancien raccourci et lance l'application.
    launch(target)
    return 0


if __name__ == '__main__':
    sys.exit(main())
