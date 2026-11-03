import io
import os
import queue
import threading
import tkinter as tk
from tkinter import ttk, filedialog, messagebox
from tkinter.scrolledtext import ScrolledText
from pathlib import Path
from PIL import Image, ImageTk
import core
import capture

DATA = Path(os.environ.get('LOCALAPPDATA', str(Path.home()))) / 'FM27_Adjoint'


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title('FM27 Adjoint • Ton banc de touche')
        self.geometry('1180x850')
        self.minsize(950, 700)
        self.configure(bg='#101e2c')
        self.events = queue.Queue()
        self.busy = False
        self.capture_pending = False
        self.images = []
        self.db = core.History(DATA / 'historique.sqlite')
        self.provider = tk.StringVar(value='Gemini en ligne')
        self.key = tk.StringVar()
        self.model = tk.StringVar()
        self.career = tk.StringVar(value='Ma carrière')
        self.mode = tk.StringVar(value='Diagnostic tactique')
        self.status = tk.StringVar(value='Ajoute des captures, configure l’IA, puis demande un avis.')
        style = ttk.Style(self)
        style.theme_use('clam')
        style.configure('TFrame', background='#101e2c')
        style.configure('TLabel', background='#101e2c', foreground='#e4edf5')
        style.configure('TButton', padding=8)
        root = ttk.Frame(self, padding=18)
        root.pack(fill='both', expand=True)
        ttk.Label(root, text='FM27  /  ADJOINT', font=('Segoe UI', 24, 'bold')).pack(anchor='w')
        ttk.Label(root, text='Observer. Comparer. Ajuster.  •  Les décisions restent les tiennes.').pack(anchor='w', pady=(0, 15))
        config = ttk.Frame(root)
        config.pack(fill='x')
        ttk.Combobox(config, textvariable=self.provider, values=['Gemini en ligne', 'Ollama local'], state='readonly', width=18).pack(side='left')
        ttk.Label(config, text='  Clé Gemini : ').pack(side='left')
        ttk.Entry(config, textvariable=self.key, show='•', width=27).pack(side='left')
        ttk.Button(config, text='Charger les modèles', command=self.load_models).pack(side='left', padx=6)
        self.model_box = ttk.Combobox(config, textvariable=self.model, width=29)
        self.model_box.pack(side='left', fill='x', expand=True)
        ttk.Label(root, text='Clé gardée en mémoire uniquement. Gemini : captures envoyées à Google après clic sur Analyser.\nLa liste des modèles ne garantit pas leur gratuité : utilise un projet sans facturation. Ollama reste local.').pack(anchor='w', pady=8)
        row = ttk.Frame(root)
        row.pack(fill='x')
        ttk.Label(row, text='Carrière : ').pack(side='left')
        ttk.Entry(row, textvariable=self.career, width=26).pack(side='left')
        ttk.Combobox(row, textvariable=self.mode, state='readonly', width=25, values=['Diagnostic tactique', 'Comparer les joueurs', 'Préparer le match', 'Débrief du match', 'Recrutement', 'Question libre']).pack(side='left', padx=10)
        ttk.Button(row, text='Historique', command=self.history).pack(side='left')
        ttk.Button(row, text='Exporter le rapport', command=self.export).pack(side='left', padx=6)
        shots = ttk.Frame(root)
        shots.pack(fill='x', pady=10)
        self.window_box = ttk.Combobox(shots, state='readonly', width=45)
        self.window_box.pack(side='left')
        ttk.Button(shots, text='Fenêtres', command=self.refresh).pack(side='left', padx=4)
        ttk.Button(shots, text='Capturer dans 5 s', command=self.delayed_capture).pack(side='left', padx=4)
        ttk.Button(shots, text='Importer images', command=self.import_images).pack(side='left', padx=4)
        ttk.Button(shots, text='Vider', command=self.clear).pack(side='left')
        self.preview = ttk.Frame(root)
        self.preview.pack(fill='x')
        self.thumbs = []
        ttk.Label(root, text='Objectif, contexte ou question (captures A → D, 4 maximum) :').pack(anchor='w', pady=(8, 3))
        self.question = ScrolledText(root, height=3, font=('Segoe UI', 11))
        self.question.pack(fill='x')
        self.question.insert('1.0', 'Analyse cet écran et propose les corrections prioritaires, avec les termes exacts visibles dans le jeu.')
        self.analyze_button = ttk.Button(root, text='DEMANDER À L’ADJOINT', command=self.analyze)
        self.analyze_button.pack(anchor='w', pady=9)
        self.output = ScrolledText(root, wrap='word', font=('Segoe UI', 11), bg='#192d3e', fg='#eef4fa', insertbackground='white', padx=15, pady=12)
        self.output.pack(fill='both', expand=True)
        ttk.Label(root, textvariable=self.status, wraplength=1080).pack(anchor='w', pady=(8, 0))
        self.refresh()
        self.after(100, self.poll)

    def run_job(self, fn, done):
        if self.busy:
            return
        self.busy = True
        self.status.set('Traitement en cours…')
        self.analyze_button.state(['disabled'])
        def worker():
            try:
                self.events.put((done, fn(), None))
            except Exception as e:
                self.events.put((done, None, str(e)))
        threading.Thread(target=worker, daemon=True).start()

    def poll(self):
        try:
            done, result, error = self.events.get_nowait()
            self.busy = False
            self.analyze_button.state(['!disabled'])
            if error:
                self.status.set(error)
                messagebox.showerror('FM27 Adjoint', error)
            else:
                try:
                    done(result)
                    self.status.set('Terminé.')
                except Exception as e:
                    self.status.set(str(e))
                    messagebox.showerror('FM27 Adjoint', str(e))
        except queue.Empty:
            pass
        self.after(100, self.poll)

    def load_models(self):
        provider, key = self.provider.get(), self.key.get().strip()
        def done(names):
            self.model_box['values'] = names
            if names:
                self.model.set(next((n for n in names if 'flash' in n and not any(t in n for t in ['preview', 'image', 'audio', 'live'])), names[0]))
            else:
                messagebox.showinfo('Modèles', 'Aucun modèle trouvé. Pour Ollama, télécharge un modèle visuel comme qwen3-vl:4b.')
        self.run_job(lambda: core.models(provider, key), done)

    def refresh(self):
        self.windows = capture.windows()
        self.window_box['values'] = [title for _, title in self.windows]
        if self.windows:
            self.window_box.current(0)

    def delayed_capture(self):
        if self.capture_pending:
            return
        if len(self.images) >= 4:
            messagebox.showinfo('Captures', 'Vide la sélection : quatre captures sont déjà présentes.')
            return
        index = self.window_box.current()
        if index < 0:
            messagebox.showinfo('Capture', 'Choisis la fenêtre de FM. La capture directe nécessite Windows ; l’import fonctionne aussi.')
            return
        hwnd = self.windows[index][0]
        self.capture_pending = True
        self.status.set('Capture dans 5 secondes. L’adjoint se réduit et affiche FM.')
        self.iconify()
        self.after(300, lambda: self.focus_game(hwnd))
        self.after(5000, lambda: self.capture_now(hwnd))

    def focus_game(self, hwnd):
        try:
            capture.activate(hwnd)
        except Exception:
            pass  # capture_now donnera le diagnostic après vérification.


    def capture_now(self, hwnd):
        try:
            image = capture.grab(hwnd)
            self.deiconify()
            self.add_image(image)
            self.status.set('Capture ajoutée. Vérifie l’aperçu avant de lancer l’analyse.')
        except Exception as e:
            self.deiconify()
            messagebox.showerror('Capture', str(e))
        finally:
            self.capture_pending = False

    def add_image(self, image):
        if len(self.images) >= 4:
            raise ValueError('Quatre captures maximum. Vide la sélection avant d’en ajouter d’autres.')
        raw = core.image_bytes(image)
        self.images.append(raw)
        thumb = Image.open(io.BytesIO(raw))
        thumb.thumbnail((230, 115))
        photo = ImageTk.PhotoImage(thumb)
        self.thumbs.append(photo)
        frame = ttk.Frame(self.preview)
        frame.pack(side='left', padx=5)
        ttk.Label(frame, text=f'Capture {chr(64+len(self.images))}').pack()
        ttk.Label(frame, image=photo).pack()

    def import_images(self):
        paths = filedialog.askopenfilenames(filetypes=[('Images', '*.png *.jpg *.jpeg *.webp')])
        for path in paths:
            try:
                with Image.open(path) as image:
                    self.add_image(image)
            except Exception as e:
                messagebox.showerror('Import', str(e))
                break

    def clear(self):
        self.images.clear()
        self.thumbs.clear()
        for widget in self.preview.winfo_children():
            widget.destroy()

    def analyze(self):
        career = self.career.get().strip()
        if not career:
            messagebox.showinfo('Carrière', 'Donne un nom à ta carrière.')
            return
        question = self.question.get('1.0', 'end').strip()
        if not question:
            return
        if not self.images and self.mode.get() != 'Question libre':
            messagebox.showinfo('Captures', 'Ajoute au moins une capture pour analyser le jeu.')
            return
        provider, key, model = self.provider.get(), self.key.get().strip(), self.model.get().strip()
        images = list(self.images)
        question = self.mode.get() + ' — ' + question
        context = self.db.context(career)
        def done(answer):
            self.db.add(career, question, answer)
            self.output.delete('1.0', 'end')
            self.output.insert('1.0', answer)
        self.run_job(lambda: core.analyze(provider, key, model, question, images, context), done)

    def history(self):
        rows = self.db.rows(self.career.get().strip())
        win = tk.Toplevel(self)
        win.title('Historique de la carrière')
        win.geometry('900x650')
        text = ScrolledText(win, wrap='word', font=('Segoe UI', 11))
        text.pack(fill='both', expand=True)
        text.insert('1.0', '\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n'.join(f'{r[1]} UTC\n{r[2]}\n\n{r[3]}' for r in rows) or 'Aucun rapport pour cette carrière.')
        text.configure(state='disabled')

    def export(self):
        text = self.output.get('1.0', 'end').strip()
        if not text:
            return
        path = filedialog.asksaveasfilename(defaultextension='.txt', initialfile='Rapport_FM27.txt', filetypes=[('Texte', '*.txt')])
        if path:
            Path(path).write_text(self.career.get() + '\n\n' + text, encoding='utf-8')
            self.status.set('Rapport exporté.')


def detach_from_terminal():
    """Reopen through pythonw so closing the launch console cannot kill the GUI."""
    import subprocess
    import sys
    if os.name != 'nt' or os.path.basename(sys.executable).lower() != 'python.exe':
        return False
    pythonw = os.path.join(os.path.dirname(sys.executable), 'pythonw.exe')
    if not os.path.isfile(pythonw):
        return False
    subprocess.Popen(
        [pythonw, os.path.abspath(__file__)],
        cwd=os.path.dirname(os.path.abspath(__file__)),
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        creationflags=0x00000008 | 0x00000200,  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
        close_fds=True,
    )
    return True


if __name__ == '__main__':
    import sys
    if detach_from_terminal():
        sys.exit(0)
    if os.name == 'nt':
        DATA.mkdir(parents=True, exist_ok=True)
        sys.stderr = open(DATA / 'application.log', 'a', encoding='utf-8', buffering=1)
        sys.stdout = sys.stderr

    if os.name == 'nt':
        import ctypes
        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(2)
        except Exception:
            pass
    App().mainloop()
