import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock
import app

class ReportTests(unittest.TestCase):
    def test_readable_headings_and_bold(self):
        output=MagicMock()
        app.App.show_report(SimpleNamespace(output=output),'## Diagnostic\nLe **milieu** manque de soutien.')
        calls=output.insert.call_args_list
        self.assertEqual(calls[0].args,('end','Diagnostic\n','heading'))
        self.assertIn(('end','milieu','bold'),[c.args for c in calls])
        output.configure.assert_called_with(state='disabled')
    def test_plain_response_is_preserved(self):
        output=MagicMock()
        app.App.show_report(SimpleNamespace(output=output),'Une observation simple.')
        text=''.join(c.args[1] for c in output.insert.call_args_list)
        self.assertEqual(text,'Une observation simple.\n')
