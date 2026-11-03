import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import unittest
from unittest.mock import patch
import app

class DetachTests(unittest.TestCase):
    @patch('subprocess.Popen')
    @patch('app.os.path.isfile',return_value=True)
    @patch('app.os.name','nt')
    @patch('sys.executable','/runtime/python.exe')
    def test_gui_is_detached(self,exists,popen):
        self.assertTrue(app.detach_from_terminal())
        self.assertEqual(popen.call_args.args[0][0],'/runtime/pythonw.exe')
        self.assertEqual(popen.call_args.kwargs['creationflags'],0x208)
    @patch('subprocess.Popen')
    @patch('app.os.name','nt')
    @patch('sys.executable','/runtime/pythonw.exe')
    def test_no_relaunch_loop(self,popen):
        self.assertFalse(app.detach_from_terminal())
        popen.assert_not_called()
