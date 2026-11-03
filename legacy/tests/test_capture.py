import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import unittest
from unittest.mock import patch, MagicMock
import capture

class CaptureTests(unittest.TestCase):
    @patch('capture.user32')
    def test_restore_and_activate(self, api):
        api.return_value.IsWindow.return_value = True
        api.return_value.IsIconic.return_value = True
        capture.activate(123)
        api.return_value.ShowWindow.assert_called_once_with(123, 9)
        api.return_value.SetForegroundWindow.assert_called_once_with(123)

    @patch('capture.user32')
    def test_closed_window(self, api):
        api.return_value.IsWindow.return_value = False
        with self.assertRaisesRegex(ValueError, 'fermée'):
            capture.activate(123)
        api.return_value.SetForegroundWindow.assert_not_called()

    @patch('PIL.ImageGrab.grab')
    @patch('capture.user32')
    def test_never_capture_wrong_window(self, api, grab):
        api.return_value.IsWindow.return_value = True
        api.return_value.IsIconic.return_value = False
        api.return_value.GetForegroundWindow.return_value = 999
        with self.assertRaisesRegex(ValueError, 'premier plan'):
            capture.grab(123)
        grab.assert_not_called()

    @patch('PIL.ImageGrab.grab')
    @patch('capture.user32')
    def test_capture_selected_bounds(self, api, grab):
        user = api.return_value
        user.IsWindow.return_value = True
        user.IsIconic.return_value = False
        user.GetForegroundWindow.return_value = 123
        def bounds(hwnd, ptr):
            ptr._obj.left, ptr._obj.top = 10, 20
            ptr._obj.right, ptr._obj.bottom = 1010, 720
            return True
        user.GetWindowRect.side_effect = bounds
        capture.grab(123)
        grab.assert_called_once_with(bbox=(10, 20, 1010, 720), all_screens=True)
