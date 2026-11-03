import sys,io,json,tempfile,urllib.error
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import unittest
from unittest.mock import patch
import core

class KeyTests(unittest.TestCase):
    def test_clean_paste(self):
        self.assertEqual(core.normalize_key('  "AIza-EXAMPLE\n"  '),'AIza-EXAMPLE')
    @patch('core.protect_key')
    def test_encrypted_storage_and_load(self,crypto):
        crypto.side_effect=[b'encrypted-data',b'example-key']
        with tempfile.TemporaryDirectory() as temp:
            p=Path(temp)/'key.dpapi'
            core.save_key(p,'example-key')
            self.assertEqual(p.read_bytes(),b'encrypted-data')
            self.assertEqual(core.load_key(p),'example-key')
            crypto.assert_called_with(b'encrypted-data',decrypt=True)
    @patch('core.protect_key',side_effect=RuntimeError('Encryption failed'))
    def test_failure_never_writes_plaintext(self,crypto):
        with tempfile.TemporaryDirectory() as temp:
            p=Path(temp)/'key.dpapi'
            with self.assertRaises(RuntimeError):core.save_key(p,'example-key')
            self.assertFalse(p.exists())
    @patch('core.urllib.request.urlopen')
    def test_invalid_key_reason_without_echo(self,transport):
        raw=json.dumps({'error':{'message':'SECRET-MUST-NOT-APPEAR','details':[{'reason':'API_KEY_INVALID'}]}}).encode()
        transport.side_effect=urllib.error.HTTPError('https://example.org',400,'',{},io.BytesIO(raw))
        with self.assertRaisesRegex(RuntimeError,'Google refuse') as caught:
            core.request_json('https://example.org',key='example-key')
        self.assertNotIn('SECRET',str(caught.exception))
