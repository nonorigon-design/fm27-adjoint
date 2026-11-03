import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import tempfile
import unittest
from unittest.mock import patch
import urllib.error
from PIL import Image
import core

class CoreTests(unittest.TestCase):
    def test_careers_and_chronology(self):
        with tempfile.TemporaryDirectory() as temp:
            db = core.History(Path(temp) / 'test.sqlite')
            db.add('OM', 'q1', 'a1')
            db.add('Standard', 'q2', 'a2')
            db.add('OM', 'q3', 'a3')
            self.assertEqual(len(db.rows('OM')), 2)
            self.assertNotIn('a2', db.context('OM'))
            self.assertLess(db.context('OM').index('a1'), db.context('OM').index('a3'))

    @patch('core.request_json')
    def test_gemini_images_and_key(self, request):
        request.return_value = {'candidates': [{'content': {'parts': [{'text': 'Conseil'}]}}]}
        self.assertEqual(core.analyze('Gemini en ligne', 'secret', 'gemini-test', 'q', [b'a', b'b']), 'Conseil')
        args = request.call_args.args
        self.assertEqual(args[2], 'secret')
        self.assertEqual(args[1]['contents'][0]['parts'][2]['inline_data']['data'], 'YQ==')
        self.assertNotIn('secret', str(args[1]))

    @patch('core.request_json')
    def test_ollama_no_cloud(self, request):
        request.return_value = {'message': {'content': 'Local'}}
        self.assertEqual(core.analyze('Ollama local', '', 'qwen3-vl:4b', 'q', [b'a']), 'Local')
        self.assertTrue(request.call_args.args[0].startswith('http://127.0.0.1:11434/'))
        self.assertFalse(request.call_args.args[1]['stream'])

    @patch('core.request_json')
    def test_empty_answer(self, request):
        request.return_value = {}
        with self.assertRaises(RuntimeError):
            core.analyze('Gemini en ligne', 'key', 'gemini-test', 'q', [])

    @patch('core.urllib.request.urlopen')
    def test_quota_no_retry(self, transport):
        transport.side_effect = urllib.error.HTTPError('https://example.org', 429, '', {}, None)
        with self.assertRaisesRegex(RuntimeError, 'Quota'):
            core.request_json('https://example.org', {})
        self.assertEqual(transport.call_count, 1)

    @patch('core.request_json')
    def test_model_pagination(self, request):
        request.side_effect = [
            {'models': [{'name': 'models/gemini-a', 'supportedGenerationMethods': ['generateContent']}], 'nextPageToken': 'next'},
            {'models': [{'name': 'models/embed', 'supportedGenerationMethods': ['embedContent']}]}]
        self.assertEqual(core.models('Gemini en ligne', 'key'), ['gemini-a'])
        self.assertIn('pageToken=next', request.call_args.args[0])

    def test_image_preparation(self):
        import io
        raw = core.image_bytes(Image.new('RGBA', (4000, 2000)))
        image = Image.open(io.BytesIO(raw))
        self.assertEqual(image.mode, 'RGB')
        self.assertLessEqual(image.width, 2560)

    def test_missing_key(self):
        with self.assertRaises(ValueError):
            core.analyze('Gemini en ligne', '', 'gemini-test', 'q', [])

if __name__ == '__main__':
    unittest.main()
