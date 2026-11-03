import ctypes
import os
from ctypes import wintypes


def user32():
    user = ctypes.windll.user32
    user.GetForegroundWindow.restype = wintypes.HWND
    user.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
    user.SetForegroundWindow.argtypes = [wintypes.HWND]
    user.BringWindowToTop.argtypes = [wintypes.HWND]
    user.IsWindow.argtypes = [wintypes.HWND]
    user.IsIconic.argtypes = [wintypes.HWND]
    user.IsWindowVisible.argtypes = [wintypes.HWND]
    user.GetWindowTextLengthW.argtypes = [wintypes.HWND]
    user.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
    return user


def windows():
    if os.name != 'nt':
        return []
    user = user32()
    found = []
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    @callback_type
    def callback(hwnd, _):
        n = user.GetWindowTextLengthW(hwnd)
        if user.IsWindowVisible(hwnd) and n:
            title = ctypes.create_unicode_buffer(n + 1)
            user.GetWindowTextW(hwnd, title, n + 1)
            if 'FM27 Adjoint' not in title.value:
                found.append((hwnd, title.value))
        return True
    user.EnumWindows(callback, 0)
    return sorted(found, key=lambda item: (not any(x in item[1].lower() for x in ['football manager', 'fm27']), item[1]))


def activate(hwnd):
    user = user32()
    if not user.IsWindow(hwnd):
        raise ValueError('La fenêtre FM est fermée. Actualise la liste des fenêtres.')
    if user.IsIconic(hwnd):
        user.ShowWindow(hwnd, 9)  # SW_RESTORE
    user.BringWindowToTop(hwnd)
    user.SetForegroundWindow(hwnd)
    # Windows peut refuser le changement de premier plan ; grab vérifie à nouveau.


def grab(hwnd):
    from PIL import ImageGrab
    user = user32()
    if not user.IsWindow(hwnd) or user.IsIconic(hwnd):
        raise ValueError('La fenêtre est fermée ou réduite. Affiche FM en mode fenêtré sans bordure.')
    if user.GetForegroundWindow() != hwnd:
        raise ValueError('Windows n’a pas laissé FM passer au premier plan. Relance la capture et clique dans FM pendant les 5 secondes, ou importe une capture du jeu.')
    rect = wintypes.RECT()
    if not user.GetWindowRect(hwnd, ctypes.byref(rect)):
        raise ValueError('Impossible de lire la fenêtre.')
    if rect.right <= rect.left or rect.bottom <= rect.top:
        raise ValueError('Dimensions de fenêtre invalides.')
    return ImageGrab.grab(bbox=(rect.left, rect.top, rect.right, rect.bottom), all_screens=True)
