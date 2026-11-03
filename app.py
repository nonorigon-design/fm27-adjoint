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
        self.title('FM27 Adjoint • Espace du coach')
        screen_height = self.winfo_screenheight()
        self.geometry(f'1320x{min(940, max(740, screen_height - 80))}')
        self.minsize(1080, min(820, max(700, screen_height - 100)))
        self.configure(bg='#f2f5f8')
        self.events = queue.Queue()
        self.busy = False
        self.capture_pending = False
        self.images = []
        self.thumbs = []
        self.db = core.History(DATA / 'historique.sqlite')
        self.provider = tk.StringVar(value='Gemini en ligne')
        self.key_file = DATA / 'gemini.dpapi'
        try:
            remembered_key = core.load_key(self.key_file)
        except Exception:
            remembered_key = ''
        self.key = tk.StringVar(value=remembered_key)
        self.model = tk.StringVar()
        self.career = tk.StringVar(value='Ma carrière')
        self.mode = tk.StringVar(value='Diagnostic tactique')
        self.status = tk.StringVar(value='Prêt. Ajoute les écrans de ton jeu pour commencer.')
        self.configure_styles()
        self.grid_columnconfigure(1, weight=1)
        self.grid_rowconfigure(0, weight=1)

        side = tk.Frame(self, bg='#101e2b', width=216)
        side.grid(row=0, column=0, sticky='nsew')
        side.grid_propagate(False)
        tk.Label(side, text='A / 27', font=('Segoe UI', 30, 'bold'), fg='#53e3bd', bg='#101e2b').pack(anchor='w', padx=24, pady=(28, 0))
        tk.Label(side, text='ADJOINT', font=('Segoe UI', 17, 'bold'), fg='white', bg='#101e2b').pack(anchor='w', padx=26)
        tk.Label(side, text='TON ESPACE DU COACH', font=('Segoe UI', 8, 'bold'), fg='#8194a6', bg='#101e2b').pack(anchor='w', padx=26, pady=(3, 28))
        tk.Label(side, text='ANALYSER', font=('Segoe UI', 8, 'bold'), fg='#8194a6', bg='#101e2b').pack(anchor='w', padx=26, pady=(0, 10))
        self.nav_buttons = {}
        for number, (mode, label) in enumerate([
            ('Diagnostic tactique', 'Tactique'), ('Comparer les joueurs', 'Joueurs'),
            ('Préparer le match', 'Avant-match'), ('Débrief du match', 'Débrief'),
            ('Recrutement', 'Recrutement'), ('Question libre', 'Discussion')], 1):
            button = tk.Button(side, text=f'{number:02d}   {label}', anchor='w', relief='flat', bd=0,
                               bg='#101e2b', fg='#adc0cf', activebackground='#243a4b', activeforeground='white',
                               font=('Segoe UI', 11), padx=16, pady=11, cursor='hand2',
                               command=lambda value=mode: self.select_mode(value))
            button.pack(fill='x', padx=12, pady=2)
            self.nav_buttons[mode] = button
        bottom = tk.Frame(side, bg='#101e2b')
        bottom.pack(side='bottom', fill='x', padx=22, pady=24)
        tk.Label(bottom, text='MA CARRIÈRE', font=('Segoe UI', 8, 'bold'), fg='#8194a6', bg='#101e2b').pack(anchor='w', pady=(0, 8))
        ttk.Entry(bottom, textvariable=self.career, width=19).pack(fill='x')
        tk.Button(bottom, text='Consulter l’historique  →', command=self.history, relief='flat', bd=0,
                  bg='#101e2b', fg='#c2d4df', activebackground='#243a4b', activeforeground='white',
                  font=('Segoe UI', 9), cursor='hand2', anchor='w').pack(fill='x', pady=(12, 24))
        tk.Label(bottom, text='VERSION 1.3.0', fg='#6e879b', bg='#101e2b', font=('Segoe UI', 8, 'bold')).pack(anchor='w')
        tk.Label(bottom, text='Ton jeu. Tes décisions.', fg='#6e879b', bg='#101e2b', font=('Segoe UI', 9)).pack(anchor='w', pady=(4, 0))

        main = tk.Frame(self, bg='#f2f5f8', padx=25, pady=21)
        main.grid(row=0, column=1, sticky='nsew')
        main.grid_columnconfigure(0, weight=1)
        main.grid_rowconfigure(4, weight=1)
        header = tk.Frame(main, bg='#f2f5f8')
        header.grid(row=0, column=0, sticky='ew', pady=(0, 17))
        tk.Label(header, text='LE BANC DE TOUCHE  /  ASSISTANT PERSONNEL', fg='#708397', bg='#f2f5f8', font=('Segoe UI', 8, 'bold')).pack(anchor='w')
        tools = tk.Frame(header, bg='#f2f5f8')
        tools.pack(fill='x', pady=(7, 0))
        self.page_title = tk.Label(tools, text='Construis ton prochain succès.', fg='#172c40', bg='#f2f5f8', font=('Segoe UI', 24, 'bold'))
        self.page_title.pack(side='left')
        ttk.Button(tools, text='Réglages IA', command=self.toggle_settings).pack(side='right', padx=(12, 0))
        self.engine_badge = tk.Label(tools, textvariable=self.provider, bg='#e0f4ee', fg='#17745c', font=('Segoe UI', 9, 'bold'), padx=12, pady=8)
        self.engine_badge.pack(side='right')
        self.page_subtitle = tk.Label(header, text='Lis le jeu. Identifie les priorités. Ajuste avec un objectif précis.', fg='#6c8093', bg='#f2f5f8', font=('Segoe UI', 10))
        self.page_subtitle.pack(anchor='w', pady=(6, 0))

        self.settings_panel = tk.Frame(main, bg='white', padx=16, pady=12, highlightbackground='#dfe6ed', highlightthickness=1)
        self.settings_panel.grid(row=1, column=0, sticky='ew', pady=(0, 12))
        self.settings_panel.grid_columnconfigure(1, weight=1)
        tk.Label(self.settings_panel, text='CONNEXION À TON ADJOINT', bg='white', fg='#294156', font=('Segoe UI', 9, 'bold')).grid(row=0, column=0, columnspan=3, sticky='w', pady=(0, 9))
        ttk.Combobox(self.settings_panel, textvariable=self.provider, values=['Gemini en ligne', 'Ollama local'], state='readonly', width=19).grid(row=1, column=0, sticky='ew', padx=(0, 10))
        ttk.Entry(self.settings_panel, textvariable=self.key, show='•').grid(row=1, column=1, sticky='ew', padx=(0, 10))
        ttk.Button(self.settings_panel, text='Valider la clé / Charger les modèles', command=self.load_models).grid(row=1, column=2)
        self.model_box = ttk.Combobox(self.settings_panel, textvariable=self.model)
        self.model_box.grid(row=2, column=0, columnspan=2, sticky='ew', pady=(9, 0), padx=(0, 10))
        ttk.Button(self.settings_panel, text='Oublier ma clé', style='Quiet.TButton', command=self.forget_key).grid(row=2, column=2, pady=(9, 0), sticky='e')
        tk.Label(self.settings_panel, text='Clé protégée par Windows après validation. Gemini : projet sans facturation pour rester dans les quotas gratuits.',
                 bg='white', fg='#738497', font=('Segoe UI', 8), wraplength=830, justify='left').grid(row=3, column=0, columnspan=3, sticky='w', pady=(8, 0))
        if remembered_key or screen_height < 950:
            self.settings_panel.grid_remove()

        capture_card = tk.Frame(main, bg='white', padx=16, pady=13, highlightbackground='#dfe6ed', highlightthickness=1)
        capture_card.grid(row=2, column=0, sticky='ew', pady=(0, 12))
        cap_header = tk.Frame(capture_card, bg='white')
        cap_header.pack(fill='x')
        tk.Label(cap_header, text='01  /  OBSERVER LE JEU', bg='white', fg='#263e53', font=('Segoe UI', 9, 'bold')).pack(side='left')
        self.shot_count = tk.StringVar(value='0 / 4 captures')
        tk.Label(cap_header, textvariable=self.shot_count, bg='#eff4f7', fg='#6a8091', font=('Segoe UI', 8), padx=9, pady=3).pack(side='right')
        bar = tk.Frame(capture_card, bg='white')
        bar.pack(fill='x', pady=(11, 0))
        self.window_box = ttk.Combobox(bar, state='readonly', width=29)
        self.window_box.pack(side='left', fill='x', expand=True, padx=(0, 8))
        ttk.Button(bar, text='Actualiser', command=self.refresh, style='Quiet.TButton').pack(side='left', padx=(0, 7))
        ttk.Button(bar, text='Capturer FM · 5 s', command=self.delayed_capture).pack(side='left', padx=(0, 7))
        ttk.Button(bar, text='Importer', command=self.import_images, style='Quiet.TButton').pack(side='left', padx=(0, 7))
        ttk.Button(bar, text='Vider', command=self.clear, style='Quiet.TButton').pack(side='left')
        self.preview = ttk.Frame(capture_card)
        self.preview.pack(fill='x', pady=(9, 0))
        self.empty_preview = tk.Label(self.preview, text='Tes captures apparaîtront ici. Compare un joueur, une tactique ou les statistiques d’un match.',
                                      font=('Segoe UI', 9), fg='#8a9bad', bg='#f5f8fa', padx=12, pady=15, anchor='w')
        self.empty_preview.pack(fill='x')

        prompt_card = tk.Frame(main, bg='white', padx=16, pady=12, highlightbackground='#dfe6ed', highlightthickness=1)
        prompt_card.grid(row=3, column=0, sticky='ew', pady=(0, 12))
        tk.Label(prompt_card, text='02  /  DONNER UN OBJECTIF', bg='white', fg='#263e53', font=('Segoe UI', 9, 'bold')).pack(anchor='w', pady=(0, 9))
        self.question = ScrolledText(prompt_card, height=2, wrap='word', relief='flat', borderwidth=0, font=('Segoe UI', 11),
                                     bg='#f3f6f9', fg='#294156', insertbackground='#167d65', padx=12, pady=10)
        self.question.pack(fill='x')
        self.question.insert('1.0', 'Analyse ma tactique : quelles sont les trois corrections prioritaires, avec les termes exacts du jeu ?')
        prompt_footer = tk.Frame(prompt_card, bg='white')
        prompt_footer.pack(fill='x', pady=(10, 0))
        tk.Label(prompt_footer, text='Les captures sont envoyées uniquement au lancement de l’analyse.', bg='white', fg='#8394a3', font=('Segoe UI', 8)).pack(side='left')
        self.analyze_button = ttk.Button(prompt_footer, text='Demander à l’adjoint  →', style='Accent.TButton', command=self.analyze)
        self.analyze_button.pack(side='right')

        report = tk.Frame(main, bg='white', padx=16, pady=13, highlightbackground='#dfe6ed', highlightthickness=1)
        report.grid(row=4, column=0, sticky='nsew')
        report.grid_columnconfigure(0, weight=1)
        report.grid_rowconfigure(1, weight=1)
        report_header = tk.Frame(report, bg='white')
        report_header.grid(row=0, column=0, sticky='ew', pady=(0, 10))
        tk.Label(report_header, text='03  /  LE REGARD DE TON ADJOINT', bg='white', fg='#263e53', font=('Segoe UI', 9, 'bold')).pack(side='left')
        ttk.Button(report_header, text='Exporter le rapport', command=self.export, style='Quiet.TButton').pack(side='right')
        self.output = ScrolledText(report, height=7, wrap='word', relief='flat', bd=0, font=('Segoe UI', 11),
                                  bg='white', fg='#344c60', insertbackground='#167d65', padx=5, pady=6, spacing1=3, spacing3=7)
        self.output.grid(row=1, column=0, sticky='nsew')
        self.output.tag_configure('heading', font=('Segoe UI', 12, 'bold'), foreground='#147d65', spacing1=13, spacing3=7)
        self.output.tag_configure('bold', font=('Segoe UI', 11, 'bold'), foreground='#1d3549')
        self.output.tag_configure('intro', font=('Segoe UI', 16, 'bold'), foreground='#203b50', spacing3=14)
        self.output.insert('end', 'Une autre lecture du match.\n', 'intro')
        self.output.insert('end', 'Ajoute tes écrans, choisis ton objectif et lance une analyse.\n\nTon adjoint distinguera les faits observés, ses hypothèses et les ajustements à tester.\nLes conseils s’appuient sur ce qui est lisible dans les captures.')
        self.output.configure(state='disabled')
        foot = tk.Frame(main, bg='#f2f5f8')
        foot.grid(row=5, column=0, sticky='ew', pady=(9, 0))
        tk.Label(foot, text='●', fg='#16a781', bg='#f2f5f8', font=('Segoe UI', 9)).pack(side='left', padx=(0, 7))
        ttk.Label(foot, textvariable=self.status, style='Status.TLabel', wraplength=850).pack(side='left', fill='x', expand=True)
        self.select_mode('Diagnostic tactique', update_prompt=False)
        self.refresh()
        self.after(100, self.poll)
        if remembered_key:
            self.after(400, self.load_models)
        else:
            self.status.set('Commence par Réglages IA pour valider ta clé Gemini ou choisir Ollama.')

    def configure_styles(self):
        style = ttk.Style(self)
        style.theme_use('clam')
        style.configure('TFrame', background='white')
        style.configure('TLabel', background='white', foreground='#344c60', font=('Segoe UI', 9))
        style.configure('Status.TLabel', background='#f2f5f8', foreground='#6c8093', font=('Segoe UI', 9))
        style.configure('TButton', background='#eaf0f5', foreground='#294156', font=('Segoe UI', 9, 'bold'),
                        borderwidth=0, padding=(11, 8), focusthickness=0)
        style.map('TButton', background=[('active', '#dce7ee'), ('disabled', '#eef2f5')], foreground=[('disabled', '#9aa8b4')])
        style.configure('Quiet.TButton', background='white', foreground='#657e91', font=('Segoe UI', 9))
        style.map('Quiet.TButton', background=[('active', '#edf3f7')])
        style.configure('Accent.TButton', background='#137e65', foreground='white', padding=(18, 10), font=('Segoe UI', 10, 'bold'))
        style.map('Accent.TButton', background=[('disabled', '#b4cfc7'), ('active', '#0b6652')], foreground=[('disabled', '#f0f6f3')])
        style.configure('TEntry', fieldbackground='#f2f6f9', foreground='#294156', padding=7, borderwidth=0)
        style.configure('TCombobox', fieldbackground='#f2f6f9', background='#e9f0f5', foreground='#294156', padding=6, borderwidth=0, arrowsize=12)
        style.map('TCombobox', fieldbackground=[('readonly', '#f2f6f9')], foreground=[('readonly', '#294156')])
        style.configure('Vertical.TScrollbar', background='#d8e2e9', troughcolor='#f4f7fa', borderwidth=0, arrowsize=10)

    def toggle_settings(self):
        if self.settings_panel.winfo_ismapped():
            self.settings_panel.grid_remove()
        else:
            self.settings_panel.grid()

    def select_mode(self, mode, update_prompt=True):
        self.mode.set(mode)
        titles = {
            'Diagnostic tactique': ('Trouve ton équilibre.', 'Des rôles cohérents, des priorités claires et des ajustements mesurables.'),
            'Comparer les joueurs': ('Le bon joueur. Le bon rôle.', 'Compare les qualités utiles au poste, à partir des écrans de tes joueurs.'),
            'Préparer le match': ('Prépare le prochain rendez-vous.', 'Mets ton effectif et les informations de l’adversaire en perspective.'),
            'Débrief du match': ('Comprends ce qui s’est joué.', 'Croise les occasions, les statistiques et le contexte du match.'),
            'Recrutement': ('Renforce ce qui compte.', 'Évalue les profils selon les besoins de ton effectif.'),
            'Question libre': ('Parlons football.', 'Pose ta question avec ou sans capture de ton jeu.')}
        prompts = {
            'Diagnostic tactique': 'Analyse ma tactique : quelles sont les trois corrections prioritaires, avec les termes exacts du jeu ?',
            'Comparer les joueurs': 'Compare les joueurs des captures A et B pour ce poste : précise les forces, les limites et les informations manquantes.',
            'Préparer le match': 'Avec ces écrans, propose un onze et les ajustements prioritaires pour affronter cet adversaire.',
            'Débrief du match': 'Analyse ces statistiques : où avons-nous été en difficulté et que faut-il tester au prochain match ?',
            'Recrutement': 'Ce joueur correspond-il aux besoins visibles de mon équipe ? Compare son profil avec les joueurs déjà présents.',
            'Question libre': 'Voici ma question : '}
        title, subtitle = titles[mode]
        self.page_title.configure(text=title)
        self.page_subtitle.configure(text=subtitle)
        for value, button in self.nav_buttons.items():
            active = value == mode
            button.configure(bg='#243b4b' if active else '#101e2b', fg='#65e6c4' if active else '#adc0cf')
        if update_prompt:
            self.question.delete('1.0', 'end')
            self.question.insert('1.0', prompts[mode])

    def show_report(self, answer):
        import re
        self.output.configure(state='normal')
        self.output.delete('1.0', 'end')
        headings = ('faits observés', 'diagnostic', 'corrections', 'comment vérifier', 'informations manquantes')
        for line in answer.splitlines():
            clean = line.strip().lstrip('#').strip()
            plain = clean.replace('**', '').rstrip(':').strip()
            if line.lstrip().startswith('#') or plain.lower() in headings:
                self.output.insert('end', plain + '\n', 'heading')
            else:
                for index, part in enumerate(re.split(r'\*\*(.*?)\*\*', line)):
                    self.output.insert('end', part, 'bold' if index % 2 else ())
                self.output.insert('end', '\n')
        self.output.configure(state='disabled')

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

    def forget_key(self):
        self.key_file.unlink(missing_ok=True)
        self.key.set('')
        self.model.set('')
        self.status.set('Clé effacée de cet ordinateur.')

    def load_models(self):
        provider, key = self.provider.get(), core.normalize_key(self.key.get())
        def done(names):
            self.model_box['values'] = names
            if names:
                if provider == 'Gemini en ligne':
                    try:
                        core.save_key(self.key_file, key)
                        self.key.set(key)
                    except Exception as error:
                        messagebox.showwarning('Mémorisation', 'La connexion fonctionne, mais la clé n’a pas pu être mémorisée. ' + str(error))
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
        if self.empty_preview is not None:
            self.empty_preview.destroy()
            self.empty_preview = None
        raw = core.image_bytes(image)
        self.images.append(raw)
        thumb = Image.open(io.BytesIO(raw))
        thumb.thumbnail((175, 85))
        photo = ImageTk.PhotoImage(thumb)
        self.thumbs.append(photo)
        frame = ttk.Frame(self.preview)
        frame.pack(side='left', padx=5)
        ttk.Label(frame, text=f'Capture {chr(64+len(self.images))}').pack()
        ttk.Label(frame, image=photo).pack()
        self.shot_count.set(f'{len(self.images)} / 4 captures')

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
        self.empty_preview = None
        self.shot_count.set('0 / 4 captures')

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
            self.show_report(answer)
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
