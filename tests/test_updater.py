import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import unittest
import tempfile
import hashlib
import base64
from unittest.mock import patch
import updater


def manifest():
    raw=b'print("ok")\n'
    return {'schema':1,'version':'1.2.0','files':{name:{'base64':base64.b64encode(raw).decode(),'sha256':hashlib.sha256(raw).hexdigest()} for name in updater.ALLOWED}}

class UpdateTests(unittest.TestCase):
    def test_valid_idempotent_update(self):
        with tempfile.TemporaryDirectory() as root:
            a=updater.install(manifest(),root)
            self.assertTrue((a/'app.py').exists())
            self.assertEqual(a,updater.install(manifest(),root))
    def test_reject_corruption(self):
        with tempfile.TemporaryDirectory() as root:
            m=manifest(); m['files']['app.py']['sha256']='0'*64
            with self.assertRaises(ValueError): updater.install(m,root)
            self.assertEqual(list(Path(root).iterdir()),[])
    def test_reject_traversal(self):
        with tempfile.TemporaryDirectory() as root:
            m=manifest(); m['files']['../bad.py']=m['files'].pop('app.py')
            with self.assertRaises(ValueError): updater.install(m,root)
    @patch('updater.subprocess',create=True)
    def test_schema_rejected(self,unused):
        with tempfile.TemporaryDirectory() as root:
            m=manifest(); m['schema']=2
            with self.assertRaises(ValueError): updater.install(m,root)
    @patch('subprocess.run')
    @patch('updater.refresh',side_effect=OSError('offline'))
    def test_offline_launch(self,refresh,run):
        run.return_value.returncode=0
        with tempfile.TemporaryDirectory() as root:
            self.assertEqual(updater.launch(Path(root),Path(root)),0)
            self.assertTrue(str(run.call_args.args[0][1]).endswith('app.py'))
    @patch('subprocess.run')
    @patch('updater.refresh')
    def test_failed_update_rolls_back(self,refresh,run):
        from types import SimpleNamespace
        run.side_effect=[SimpleNamespace(returncode=1),SimpleNamespace(returncode=0)]
        with tempfile.TemporaryDirectory() as root:
            refresh.return_value=Path(root)/'new'
            self.assertEqual(updater.launch(Path(root),Path(root)),0)
            self.assertEqual(run.call_count,2)
            self.assertFalse((Path(root)/'current.json').exists())
