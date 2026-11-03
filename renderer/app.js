'use strict';
(() => {
  const A = window.adjoint;
  const $ = (id) => document.getElementById(id);
  const SECTIONS = [['direct', '◉'], ['tactique', 'T'], ['joueurs', 'J'], ['avantmatch', 'A'], ['debrief', 'D'], ['recrutement', 'R'], ['discussion', 'C']];
  const TITLES = {
    direct: ['Ton adjoint, en direct.', 'Il observe Football Manager et te conseille au fil des écrans, sans que tu ajoutes de captures.'],
    tactique: ['Trouve ton équilibre.', 'Formation, rôles et consignes avec et sans ballon, lus sur tes captures.'],
    joueurs: ['Le bon joueur, le bon rôle.', 'Compare les attributs utiles au poste, pas seulement les étoiles.'],
    avantmatch: ['Prépare le prochain rendez-vous.', 'Effectif, adversaire et ajustements à partir de ce qui est visible.'],
    debrief: ['Comprends ce qui s’est joué.', 'Tirs, statistiques et contexte — sans conclure sur un seul match.'],
    recrutement: ['Renforce ce qui compte.', 'Évalue une recrue selon les besoins réels de ton équipe.'],
    discussion: ['Parlons football.', 'Pose une question, avec ou sans capture. Le contexte de la carrière est conservé.'],
  };
  const KIND_TITLES = { invalid_key: 'Clé Gemini invalide', forbidden: 'Accès refusé', quota: 'Quota atteint', model_missing: 'Modèle indisponible', model_incompatible: 'Modèle incompatible avec les images', connection: 'Problème de connexion', ollama_down: 'Moteur local injoignable', memory: 'Mémoire insuffisante', empty: 'Réponse vide', server: 'Service indisponible' };

  const state = { live: { on: false, items: [] }, setupRunning: false, info: null, settings: null, section: 'tactique', images: [], busy: false, keyStatus: { has: false, tail: '' }, ollama: null, models: { gemini: [], ollama: [] }, update: null, lastReport: null, drafts: {}, lastWatch: null };

  // ---------- utilitaires ----------
  function el(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(k));
    return n;
  }
  function toast(msg, isErr) { const t = el('div', { class: 'toast' + (isErr ? ' err' : ''), text: msg }); $('toasts').append(t); setTimeout(() => t.remove(), isErr ? 7000 : 3500); }
  const put = (parent, ...kids) => parent.append(...kids.flat().filter((k) => k != null && k !== false));
  // Appelle le processus principal ; retourne data ou lève une erreur typée.
  async function call(promise) {
    const r = await promise;
    if (!r.ok) { const e = new Error(r.error.message); e.kind = r.error.kind; e.retryAfter = r.error.retryAfter; throw e; }
    return r.data;
  }
  const fmtDate = (iso) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  const providerLabel = () => (state.settings.provider === 'ollama' ? 'Moteur local · ' + (state.settings.ollamaModel || 'à choisir') : 'Gemini · ' + (state.settings.geminiModel || 'à choisir'));

  // ---------- navigation (les brouillons sont conservés par section) ----------
  function renderNav() {
    const nav = $('nav'); nav.replaceChildren();
    for (const [id, letter] of SECTIONS) {
      nav.append(el('button', { 'aria-current': id === state.section ? 'page' : null, onclick: () => selectSection(id) }, el('i', { text: letter }), state.info.modes[id].label));
    }
  }
  function selectSection(id) {
    state.drafts[state.section] = $('question').value;
    state.section = id;
    A.settings.set({ section: id });
    $('title').textContent = TITLES[id][0]; $('subtitle').textContent = TITLES[id][1];
    $('question').value = state.drafts[id] ?? ''; $('question').placeholder = state.info.modes[id].placeholder;
    $('ask-title').textContent = id === 'discussion' ? '2 · Discuter' : (id === 'direct' ? 'Poser une question maintenant' : '2 · Poser la question');
    $('grid').dataset.section = id;
    renderNav(); renderThread(); if (id !== 'direct') showReportFor(id); updatePrivacy();
  }
  async function renderThread() {
    const box = $('thread');
    if (state.section !== 'discussion') { box.hidden = true; return; }
    const msgs = await call(A.history.messages(careerName()));
    box.hidden = !msgs.length; box.replaceChildren(...msgs.slice(-30).map((m) => el('div', { class: 'msg ' + m.role, text: m.text })));
    box.scrollTop = box.scrollHeight;
  }
  const careerName = () => $('career').value.trim() || 'Ma carrière';

  // ---------- captures ----------
  function renderThumbs() {
    $('count').textContent = `${state.images.length} / 6`;
    $('thumbs').replaceChildren(...state.images.map((im, i) => el('div', { class: 'thumb', onclick: () => openLightbox(im) },
      el('img', { src: im.thumb, alt: 'Capture ' + String.fromCharCode(65 + i) }),
      el('span', { class: 'tag', text: String.fromCharCode(65 + i) }),
      el('button', { class: 'x', title: 'Retirer', 'aria-label': 'Retirer la capture', onclick: async (e) => { e.stopPropagation(); await A.capture.remove(im.id); state.images = state.images.filter((x) => x.id !== im.id); renderThumbs(); } }, '×'),
      el('div', { class: 'cap', text: im.label }))));
  }
  function openLightbox(im) { $('lightbox').querySelector('img').src = im.thumb; $('lightbox').hidden = false; }
  async function addCapture(promise) {
    try { const im = await call(promise); for (const x of [].concat(im)) state.images.push(x); renderThumbs(); }
    catch (e) { toast(e.message, true); }
  }
  async function refreshWindows() {
    try {
      const wins = await call(A.capture.windows()), screens = await call(A.capture.screens());
      $('win-select').replaceChildren(...wins.map((w) => el('option', { value: w.id, text: (w.fm ? '★ ' : '') + w.name })));
      $('screen-select').replaceChildren(...screens.map((s) => el('option', { value: s.id, text: s.name })));
    } catch (e) { toast(e.message, true); }
  }

  // ---------- rapport ----------
  function emptyReport() {
    $('report').replaceChildren(el('div', { class: 'empty' }, el('b', { text: 'Pas encore d’analyse' }), 'Ajoute tes captures, écris ta demande, puis clique sur « Analyser maintenant ». Les conseils distingueront ce qui est lu, ce qui est incertain, les hypothèses et les corrections.'));
  }
  function showReport(r) {
    state.lastReport = r;
    const meta = el('div', { class: 'report-meta', text: `${fmtDate(r.at)} · ${r.engine === 'ollama' ? 'moteur local' : 'Gemini'} ${r.model} · ${r.images} capture(s) · ${r.mode}` });
    $('report').replaceChildren(meta, window.Markdown.render(document, r.answer));
  }
  function showError(e) {
    const cls = e.kind === 'quota' ? 'err quota' : 'err';
    const box = el('div', { class: cls }, el('b', { text: KIND_TITLES[e.kind] || 'Erreur' }), e.message);
    if (['invalid_key', 'forbidden', 'ollama_down', 'model_missing', 'model_incompatible', 'memory'].includes(e.kind)) box.append(el('div', { class: 'row' }, el('button', { class: 'btn small', onclick: () => openSettings(), text: 'Ouvrir les réglages IA' })));
    if (e.kind === 'quota' && state.settings.provider === 'gemini') box.append(el('div', { class: 'row' }, el('button', { class: 'btn small', text: 'Passer au moteur local', onclick: async () => { state.settings = await call(A.settings.set({ provider: 'ollama' })); renderEngine(); openSettings(); } })));
    $('report').replaceChildren(box);
  }
  async function showReportFor(section) {
    if (state.lastReport && state.lastReport.mode === section) return showReport(state.lastReport);
    const list = await call(A.history.reports(careerName()));
    const last = list.find((r) => r.mode === section);
    last ? showReport(last) : emptyReport();
  }
  function updatePrivacy() {
    const n = state.images.length;
    const what = n ? `${n} capture(s)` : (state.section === 'discussion' ? 'ta question' : 'une capture automatique de Football Manager');
    $('privacy').textContent = state.settings.provider === 'gemini'
      ? `Ce clic enverra ${what}, ta question et un court historique à Google (Gemini).`
      : (n ? 'Analyse 100 % locale : rien ne quitte ton ordinateur.' : 'Sans capture ajoutée, l’adjoint regarde Football Manager lui-même. Analyse 100 % locale.');
  }
  function renderEngine() {
    const p = $('engine-pill'); p.textContent = providerLabel();
    const missing = !(state.settings.provider === 'ollama' ? state.settings.ollamaModel : state.settings.geminiModel);
    p.classList.toggle('bad', missing); updatePrivacy();
  }
  async function analyze() {
    if (state.busy) return;
    const question = $('question').value.trim();
    if (!question) return toast('Écris d’abord ta question.', true);
    state.busy = true; $('analyze').disabled = true; $('cancel').hidden = false; $('analyze-progress').hidden = false;
    $('progress-text').textContent = state.settings.provider === 'ollama' ? 'Analyse locale en cours (peut durer une à plusieurs minutes)…' : 'Analyse en cours…';
    try {
      const r = await call(A.analyze({ mode: state.section, question, imageIds: state.images.map((i) => i.id), career: careerName() }));
      if (state.section === 'direct') { feedAdd({ id: 'q' + Date.now(), state: 'done', answer: r.answer, question, at: Date.now(), q: true }); $('question').value = ''; state.drafts.direct = ''; }
      else showReport(r);
      if (state.section === 'discussion') { $('question').value = ''; state.drafts.discussion = ''; renderThread(); }
    } catch (e) { if (e.kind !== 'cancelled') showError(e); else toast('Analyse annulée.'); }
    finally { state.busy = false; $('analyze').disabled = false; $('cancel').hidden = true; $('analyze-progress').hidden = true; }
  }

  // ---------- panneau latéral ----------
  function openDrawer(nodes) { $('drawer-body').replaceChildren(...nodes); $('drawer').hidden = false; $('drawer-close').focus(); }
  function closeDrawer() { $('drawer').hidden = true; state.drawer = null; }

  async function openSettings(tab) {
    state.drawer = 'settings';
    const s = state.settings, body = [];
    body.push(el('h2', { text: 'Réglages IA et application' }));
    const seg = el('div', { class: 'seg' },
      el('button', { 'aria-pressed': String(s.provider === 'ollama'), text: 'Moteur local (Ollama)', onclick: () => switchProvider('ollama') }),
      el('button', { 'aria-pressed': String(s.provider === 'gemini'), text: 'Gemini en ligne', onclick: () => switchProvider('gemini') }));
    body.push(seg);
    body.push(s.provider === 'ollama' ? await localPanel() : await geminiPanel());
    body.push(el('h3', { text: 'Raccourci clavier global' }), shortcutPanel());
    body.push(el('h3', { text: 'Mises à jour' }), updatePanel());
    body.push(el('h3', { text: 'Diagnostic' }), el('div', { class: 'panel' },
      el('div', { class: 'kv' }, el('span', { text: 'Protection de la clé par Windows' }), el('span', { class: state.info.encryption ? 'ok' : 'bad', text: state.info.encryption ? 'disponible' : 'indisponible' })),
      el('button', { class: 'btn small', text: 'Afficher le journal (sans clé)', onclick: () => A.openLogs() })));
    openDrawer(body);
  }
  async function switchProvider(p) { state.settings = await call(A.settings.set({ provider: p })); renderEngine(); openSettings(); }

  async function localPanel() {
    const wrap = el('div');
    let st, hw;
    try { st = await call(A.ollama.status()); hw = await call(A.hardware()); } catch (e) { return el('div', { class: 'err', text: e.message }); }
    state.ollama = st;
    const rec = hw.model;
    put(wrap, el('div', { class: 'panel' },
      el('div', { class: 'kv' }, el('span', { text: 'Ollama' }), el('span', { class: st.running ? 'ok' : (st.installed ? 'warn' : 'bad'), text: st.running ? 'en marche' : (st.installed ? 'installé, arrêté' : 'non installé') })),
      el('div', { class: 'kv' }, el('span', { text: 'Matériel détecté' }), el('span', { text: `${hw.ramGb} Go RAM${hw.vramGb ? ' · ' + hw.vramGb + ' Go vidéo' : ''}` })),
      hw.gpu ? el('div', { class: 'kv' }, el('span', { text: 'Carte graphique' }), el('span', { text: hw.gpu })) : null,
      el('p', { class: 'hint', text: hw.reason })));
    if (!st.installed) {
      put(wrap, el('div', { class: 'panel' }, el('p', { text: 'Ollama exécute l’IA sur ton PC, gratuitement. Il n’est pas encore installé.' }),
        el('div', { class: 'row' },
          el('button', { class: 'btn primary', text: 'Installer l’IA gratuite (automatique)', onclick: () => { closeDrawer(); openWizard(); } }),
          el('button', { class: 'btn', text: 'Installer Ollama (winget)', onclick: async (ev) => { ev.target.disabled = true; ev.target.textContent = 'Installation…'; try { await call(A.ollama.install()); toast('Ollama installé.'); } catch (e) { toast(e.message, true); } openSettings(); } }),
          el('button', { class: 'btn', text: 'Télécharger depuis ollama.com', onclick: () => A.openExternal('https://ollama.com/download') }))));
      return wrap;
    }
    if (!st.running) put(wrap, el('div', { class: 'panel' }, el('button', { class: 'btn primary', text: 'Démarrer Ollama', onclick: async () => { try { await call(A.ollama.start()); } catch (e) { toast(e.message, true); } openSettings(); } })));
    // Modèles installés
    const names = st.models.map((m) => m.name);
    const sel = el('select', { 'aria-label': 'Modèle local', onchange: async (e) => { state.settings = await call(A.settings.set({ ollamaModel: e.target.value })); renderEngine(); } }, ...names.map((n) => el('option', { value: n, text: n, selected: n === state.settings.ollamaModel })));
    if (names.length && !names.includes(state.settings.ollamaModel)) { state.settings = await call(A.settings.set({ ollamaModel: names.find((n) => /vl|vision|llava|gemma|minicpm/i.test(n)) || names[0] })); renderEngine(); sel.value = state.settings.ollamaModel; }
    put(wrap, el('h3', { text: 'Modèle de vision' }), el('div', { class: 'panel' },
      names.length ? el('div', { class: 'row' }, sel) : el('p', { class: 'hint', text: 'Aucun modèle téléchargé.' }),
      el('p', { class: 'hint', text: 'Un modèle texte seul ne peut pas lire les captures : choisis un modèle avec vision.' })));
    if (rec && !names.includes(rec.tag)) {
      const bar = el('div', { class: 'bar', hidden: true }, el('i')), txt = el('div', { class: 'hint' });
      const btn = el('button', { class: 'btn primary', text: `Télécharger ${rec.tag} (≈ ${rec.sizeGb} Go)` });
      const cancel = el('button', { class: 'btn ghost', text: 'Annuler', hidden: true, onclick: () => A.ollama.cancelPull() });
      btn.onclick = async () => {
        btn.disabled = true; cancel.hidden = false; bar.hidden = false; txt.textContent = 'Connexion…';
        const off = A.ollama.onProgress((p) => { if (p.percent != null) { bar.firstChild.style.width = p.percent + '%'; txt.textContent = `${p.percent} % · ${(p.done / 1e9).toFixed(2)} / ${(p.total / 1e9).toFixed(2)} Go`; } else txt.textContent = p.status; });
        try { await call(A.ollama.pull(rec.tag)); state.settings = await call(A.settings.set({ ollamaModel: rec.tag })); toast('Modèle prêt.'); renderEngine(); }
        catch (e) { toast(e.kind === 'cancelled' ? 'Téléchargement interrompu : relance pour reprendre là où il s’était arrêté.' : e.message, true); }
        finally { off(); openSettings(); }
      };
      put(wrap, el('div', { class: 'panel' }, el('b', { text: 'Recommandé pour ton PC : ' + rec.tag }), el('p', { class: 'hint', text: 'Le téléchargement peut prendre plusieurs minutes. S’il est interrompu, le relancer reprend la progression.' }), el('div', { class: 'row' }, btn, cancel), bar, txt));
    }
    return wrap;
  }

  async function geminiPanel() {
    const wrap = el('div');
    state.keyStatus = await call(A.key.status());
    const input = el('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: state.keyStatus.has ? '•••••••• (clé enregistrée)' : 'Colle ta clé API Gemini' });
    const msg = el('div', { class: 'hint' });
    const save = el('button', { class: 'btn primary', text: state.keyStatus.has ? 'Remplacer la clé' : 'Valider et enregistrer' });
    save.onclick = async () => {
      if (!input.value.trim()) return msg.replaceChildren('Colle ta clé d’abord.');
      save.disabled = true; msg.textContent = 'Vérification auprès de Google…';
      try {
        const r = await call(A.key.saveValidated(input.value)); input.value = '';
        state.models.gemini = r.models;
        if (!r.models.includes(state.settings.geminiModel)) state.settings = await call(A.settings.set({ geminiModel: r.default }));
        toast('Clé validée et enregistrée (protégée par ton compte Windows).'); renderEngine();
      } catch (e) { msg.replaceChildren(el('span', { class: e.kind === 'quota' ? 'warn' : 'bad', text: (KIND_TITLES[e.kind] || 'Erreur') + ' — ' + e.message })); save.disabled = false; return; }
      openSettings();
    };
    put(wrap, el('div', { class: 'panel' },
      el('div', { class: 'kv' }, el('span', { text: 'Clé' }), el('span', { class: state.keyStatus.has ? 'ok' : 'warn', text: state.keyStatus.has ? 'enregistrée (…' + state.keyStatus.tail + ')' : 'aucune' })),
      input, el('div', { class: 'row' }, save, state.keyStatus.has ? el('button', { class: 'btn danger', text: 'Oublier la clé', onclick: async () => { await A.key.forget(); state.settings = await call(A.settings.set({ geminiModel: '' })); renderEngine(); openSettings(); } }) : null), msg,
      el('button', { class: 'btn small ghost', text: 'Créer une clé dans Google AI Studio', onclick: () => A.openExternal('https://aistudio.google.com/apikey') }),
      el('p', { class: 'hint', text: 'La clé est vérifiée avant d’être enregistrée, puis chiffrée par ton compte Windows. Elle n’apparaît jamais dans le journal.' })));
    if (state.keyStatus.has) {
      let models = state.models.gemini;
      if (!models.length) { try { models = state.models.gemini = (await call(A.gemini.models())).models; } catch (e) { put(wrap, el('div', { class: e.kind === 'quota' ? 'err quota' : 'err' }, el('b', { text: KIND_TITLES[e.kind] || 'Erreur' }), e.message)); return wrap; } }
      const sel = el('select', { 'aria-label': 'Modèle Gemini', onchange: async (e) => { state.settings = await call(A.settings.set({ geminiModel: e.target.value })); renderEngine(); } }, ...models.map((n) => el('option', { value: n, text: n, selected: n === state.settings.geminiModel })));
      if (!models.includes(state.settings.geminiModel) && models.length) { state.settings = await call(A.settings.set({ geminiModel: models[0] })); renderEngine(); sel.value = models[0]; }
      put(wrap, el('h3', { text: 'Modèle' }), el('div', { class: 'panel' }, sel,
        el('p', { class: 'hint', text: 'La liste de l’API ne dit pas quels modèles sont gratuits pour ton projet. Avec un projet sans facturation, tu restes dans le palier gratuit ; si le quota est atteint, l’adjoint te le dit — il ne passe jamais à un service payant et ne réessaie pas en boucle.' }),
        el('p', { class: 'hint', text: 'Attention : Google indique que, sur le palier gratuit, le contenu envoyé peut servir à améliorer ses produits. Évite d’y envoyer des captures sensibles ; le moteur local reste 100 % privé.' })));
    }
    return wrap;
  }

  function shortcutPanel() {
    const input = el('input', { type: 'text', readonly: true, value: state.settings.shortcut || '', 'aria-label': 'Raccourci' });
    const msg = el('div', { class: 'hint', text: 'Clique dans le champ puis appuie sur ta combinaison (ex. Ctrl + Alt + A). Elle capture Football Manager, même si l’adjoint est sur l’autre écran.' });
    input.addEventListener('keydown', async (e) => {
      e.preventDefault();
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
      const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean);
      let key = e.key.length === 1 ? e.key.toUpperCase() : ({ ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Enter: 'Return' }[e.key] || e.key);
      if (!mods.length) return msg.replaceChildren('Ajoute Ctrl, Alt ou Maj.');
      try { const acc = await call(A.shortcut.set([...mods, key].join('+'))); state.settings.shortcut = acc; input.value = acc; $('shortcut-hint').textContent = 'Raccourci : ' + acc.replace('Control', 'Ctrl'); msg.textContent = 'Raccourci enregistré.'; }
      catch (err) { msg.replaceChildren(el('span', { class: 'bad', text: err.message })); }
    });
    return el('div', { class: 'panel' }, input, msg);
  }

  function updatePanel() {
    const u = state.update || { current: state.info.version, state: 'idle', message: '' };
    const wrap = el('div', { class: 'panel', id: 'update-panel' });
    put(wrap, el('div', { class: 'kv' }, el('span', { text: 'Version installée' }), el('span', { text: u.current })),
      el('div', { class: 'kv' }, el('span', { text: 'Version disponible' }), el('span', { text: u.available || '—' })),
      u.state === 'downloading' ? el('div', { class: 'bar' }, el('i', { style: `width:${u.percent || 0}%` })) : null,
      el('p', { class: 'hint', text: u.message || 'Vérifié au démarrage. Sans Internet, la version installée s’ouvre normalement.' }),
      el('div', { class: 'row' }, el('button', { class: 'btn', text: 'Rechercher une mise à jour', onclick: async () => { await A.update.check(); } }),
        u.state === 'ready' ? el('button', { class: 'btn primary', text: 'Redémarrer et installer', onclick: () => A.update.install() }) : null));
    return wrap;
  }
  function onUpdate(u) {
    state.update = u;
    const pill = $('update-pill');
    if (u.state === 'ready') { pill.hidden = false; pill.className = 'pill upd'; pill.textContent = `Mise à jour ${u.available} prête — redémarrer`; pill.onclick = () => A.update.install(); }
    else if (u.state === 'downloading') { pill.hidden = false; pill.className = 'pill'; pill.textContent = `Mise à jour ${u.percent || 0} %`; pill.onclick = () => openSettings(); }
    else pill.hidden = true;
    if (state.drawer === 'settings') { const old = document.getElementById('update-panel'); if (old) old.replaceWith(updatePanel()); }
  }

  // ---------- historique et changements testés ----------
  async function openHistory() {
    state.drawer = 'history';
    const career = careerName();
    const [reports, changes] = await Promise.all([call(A.history.reports(career)), call(A.history.changes(career))]);
    const body = [el('h2', { text: 'Carrière : ' + career })];
    // changements testés
    body.push(el('h3', { text: 'Changements testés' }));
    const desc = el('input', { type: 'text', placeholder: 'Ex. : passage en 4-2-3-1, ailier gauche en … ', maxlength: 500 });
    const before = el('input', { type: 'text', placeholder: 'Avant : résultats/statistiques sur les derniers matchs', maxlength: 500 });
    body.push(el('div', { class: 'panel' }, desc, before, el('div', { class: 'row' }, el('button', { class: 'btn primary small', text: 'Noter ce changement', onclick: async () => { try { await call(A.history.addChange(career, { description: desc.value, before: before.value })); openHistory(); } catch (e) { toast(e.message, true); } } }))));
    for (const c of changes) {
      const after = el('input', { type: 'text', value: c.after, placeholder: 'Après : résultats sur plusieurs matchs', maxlength: 500 });
      const verdict = el('input', { type: 'text', value: c.verdict, placeholder: 'Verdict (garder, annuler, à rejuger…)', maxlength: 500 });
      body.push(el('div', { class: 'panel' }, el('b', { text: c.description }), el('div', { class: 'hint', text: fmtDate(c.at) + (c.before ? ' · Avant : ' + c.before : '') }), after, verdict,
        el('button', { class: 'btn small', text: 'Enregistrer', onclick: async () => { await call(A.history.updateChange(career, c.id, { after: after.value, verdict: verdict.value })); toast('Enregistré.'); } })));
    }
    body.push(el('h3', { text: 'Rapports précédents' }));
    if (!reports.length) body.push(el('p', { class: 'hint', text: 'Aucun rapport pour cette carrière.' }));
    const list = el('div', { class: 'panel' });
    for (const r of reports.slice(0, 50)) list.append(el('div', { class: 'hist-item', onclick: () => { showReport(r); closeDrawer(); }, tabindex: '0' }, el('b', { text: r.question.slice(0, 110) }), el('span', { text: `${fmtDate(r.at)} · ${r.mode} · ${r.model || ''}` })));
    if (reports.length) body.push(list);
    openDrawer(body);
  }

  // ---------- démarrage ----------
  async function init() {
    state.info = await call(A.info());
    state.settings = await call(A.settings.get());
    $('ver').textContent = state.info.version;
    $('career').value = state.settings.career;
    const careers = await call(A.history.careers());
    $('careers').replaceChildren(...careers.map((c) => el('option', { value: c })));
    $('shortcut-hint').textContent = state.settings.shortcut ? 'Raccourci : ' + state.settings.shortcut.replace('Control', 'Ctrl') : '';
    if (state.info.failedPreviousBoot) { $('notice').hidden = false; $('notice').textContent = 'Le dernier démarrage de cette version ne s’est pas terminé correctement. Si le problème persiste, réinstalle la version précédente depuis la page des versions du dépôt GitHub.'; }
    renderThumbs(); renderEngine(); emptyReport();
    state.section = state.settings.section && state.info.modes[state.settings.section] ? state.settings.section : 'direct';
    selectSection(state.section);
    refreshWindows(); renderLive();
    onUpdate(await call(A.update.state()));
    maybeOfferSetup();
    // Restaure et valide la clé mémorisée au lancement (simple lecture de la liste des modèles, aucune donnée de jeu).
    if (state.settings.provider === 'gemini') {
      const ks = await call(A.key.status());
      if (ks.has) call(A.gemini.models()).then((r) => { state.models.gemini = r.models; }).catch((e) => { toast(`Clé enregistrée mais ${KIND_TITLES[e.kind] || 'erreur'} : ${e.message}`, true); });
    }
  }


  // ---------- coach en direct ----------
  const fmtTime = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  function feedAdd(item) {
    const i = state.live.items.findIndex((x) => x.id === item.id);
    if (i >= 0) state.live.items[i] = { ...state.live.items[i], ...item }; else state.live.items.unshift(item);
    state.live.items = state.live.items.slice(0, 30);
    renderFeed();
  }
  function renderFeed() {
    const box = $('feed');
    if (!state.live.items.length) {
      box.replaceChildren(el('div', { class: 'empty' }, el('b', { text: 'En attente d’un écran' }), state.live.on ? 'Le coach observe Football Manager. Change d’écran dans le jeu : un conseil apparaîtra ici.' : 'Clique sur « Démarrer le coach en direct », puis joue normalement.'));
      return;
    }
    box.replaceChildren(...state.live.items.map((it, idx) => {
      const body = it.state === 'analyzing' ? el('div', { class: 'txt', text: 'Le coach lit cet écran…' })
        : it.state === 'quiet' ? el('div', { class: 'txt', text: 'Rien de particulier à signaler sur cet écran.' })
        : it.state === 'error' ? el('div', { class: 'txt' }, el('b', { text: (KIND_TITLES[it.error.kind] || 'Erreur') + ' — ' }), it.error.message)
        : el('div', { class: 'txt', text: it.answer });
      return el('div', { class: `fitem ${it.state}${it.q ? ' q' : ''}${idx === 0 && it.state === 'done' ? ' fresh' : ''}` },
        it.thumb ? el('img', { src: it.thumb, alt: '' }) : el('div'),
        el('div', {}, el('div', { class: 'meta', text: fmtTime(it.at) + (it.q ? ' · ta question : ' + (it.question || '').slice(0, 80) : '') }), body));
    }));
  }
  function renderLive() {
    const on = state.live.on;
    $('live-toggle').textContent = on ? 'Arrêter le coach en direct' : 'Démarrer le coach en direct';
    $('live-toggle').classList.toggle('on', on);
    const st = $('live-state'); st.textContent = on ? 'En direct' : 'Arrêté'; st.classList.toggle('on', on);
    const opts = $('live-opts'); opts.replaceChildren();
    if (state.settings.provider === 'gemini') {
      const cb = el('input', { type: 'checkbox', id: 'live-cloud' }); cb.checked = !!state.settings.liveCloud;
      cb.onchange = async () => { state.settings = await call(A.settings.set({ liveCloud: cb.checked })); renderLive(); };
      opts.append(el('label', { class: 'switch' }, cb, el('span'), 'J’autorise l’envoi de chaque nouvel écran à Google (Gemini)'));
    }
    $('live-privacy').textContent = state.settings.provider === 'gemini'
      ? (state.settings.liveCloud ? 'Chaque nouvel écran est envoyé à Google ; le quota gratuit peut être atteint vite. Le coach s’arrête seul si le quota est dépassé.' : 'Avec Gemini, le direct reste bloqué tant que tu ne l’as pas autorisé ci-dessus. Le moteur local évite tout envoi.')
      : 'Moteur local : rien ne quitte ton ordinateur. Un nouvel écran est analysé au plus toutes les ~12 secondes.';
    renderFeed();
  }
  async function toggleLive() {
    try {
      const wantOn = !state.live.on;
      if (wantOn) { // vérifie qu'un moteur est prêt avant de démarrer
        const model = state.settings.provider === 'ollama' ? state.settings.ollamaModel : state.settings.geminiModel;
        if (!model) { toast('Aucune IA prête : installe l’IA gratuite ou configure Gemini.', true); return state.settings.provider === 'ollama' ? openWizard() : openSettings(); }
      }
      state.live.on = await call(A.live.set(wantOn)); renderLive();
    } catch (e) { toast(e.message, true); }
  }
  function onLive(ev) {
    if (ev.type === 'state') {
      state.live.on = ev.on; renderLive();
      if (!ev.on && ev.reason) toast(ev.reason === 'quota' ? 'Coach arrêté : quota Gemini atteint.' : ev.reason === 'errors' ? 'Coach arrêté après plusieurs erreurs : vérifie le moteur IA.' : 'Coach arrêté : ' + ev.reason, true);
    } else if (ev.type === 'item') feedAdd(ev);
    else if (ev.type === 'notice') { if (ev.message !== state.lastNotice) { state.lastNotice = ev.message; toast(ev.message, true); } }
  }

  // ---------- installation automatique de l'IA gratuite ----------
  const WIZ_STEPS = [['hardware', 'Analyse de ton PC'], ['install', 'Installation du moteur Ollama'], ['start', 'Démarrage du moteur'], ['model', 'Téléchargement du modèle de vision'], ['test', 'Vérification sur une image']];
  async function openWizard(auto) {
    let hw = null; try { hw = await call(A.hardware()); } catch { /* affiché plus bas */ }
    const body = $('wizard-body'); $('wizard').hidden = false;
    const steps = el('ul', { class: 'wiz-steps' }, ...WIZ_STEPS.map(([id, label]) => el('li', { 'data-step': id }, el('i', { text: '·' }), label)));
    const bar = el('div', { class: 'bar', hidden: true }, el('i')), txt = el('div', { class: 'hint' });
    const go = el('button', { class: 'btn primary big', text: 'Installer l’IA gratuite' });
    const later = el('button', { class: 'btn ghost', text: auto ? 'Plus tard' : 'Fermer', onclick: () => { $('wizard').hidden = true; } });
    const gem = el('button', { class: 'btn', text: 'Utiliser Gemini à la place', onclick: async () => { $('wizard').hidden = true; state.settings = await call(A.settings.set({ provider: 'gemini' })); renderEngine(); openSettings(); } });
    const cancel = el('button', { class: 'btn ghost', text: 'Interrompre', hidden: true, onclick: () => A.engine.cancel() });
    const size = hw?.model ? `≈ ${hw.model.sizeGb} Go` : 'plusieurs Go';
    body.replaceChildren(
      el('h2', { id: 'wiz-title', text: 'Ton adjoint IA gratuit, installé en un clic' }),
      el('p', { text: `L’IA tourne sur ton PC : gratuite, sans clé, sans quota, et rien n’est envoyé en ligne. Elle sera lancée automatiquement avec l’adjoint.` }),
      el('p', { class: 'hint', text: hw ? `${hw.ramGb} Go de RAM${hw.vramGb ? ' · ' + hw.vramGb + ' Go de mémoire vidéo' : ''}. ${hw.reason}` : 'Détection du matériel impossible.' }),
      el('p', { class: 'hint', text: `Téléchargements : le moteur Ollama (installateur de plusieurs centaines de Mo) puis le modèle ${hw?.model ? hw.model.tag : ''} (${size}). Prévois quelques minutes ; en cas d’interruption, relancer reprend le téléchargement.` }),
      steps, bar, txt, el('div', { class: 'wiz-actions' }, cancel, later, gem, go));
    if (!hw?.model) { go.disabled = true; return; }
    const mark = (id, mode) => { let seen = false; for (const li of steps.children) { if (li.dataset.step === id) { seen = true; li.className = mode; li.firstChild.textContent = mode === 'done' ? '✓' : '·'; } else if (!seen && mode === 'active') { li.className = 'done'; li.firstChild.textContent = '✓'; } } };
    go.onclick = async () => {
      state.setupRunning = true; go.disabled = true; later.disabled = true; gem.disabled = true; cancel.hidden = false;
      const off = A.engine.onStep((st) => {
        mark(st.id, st.id === 'done' ? 'done' : 'active');
        if (st.id === 'done') { for (const li of steps.children) { li.className = 'done'; li.firstChild.textContent = '✓'; } }
        bar.hidden = st.percent == null && !st.indeterminate; bar.firstChild.style.width = (st.percent ?? 100) + '%'; bar.firstChild.style.opacity = st.indeterminate ? '.4' : '1';
        txt.textContent = st.label + (st.percent != null && st.total ? ` ${st.percent} % · ${(st.done / 1e9).toFixed(2)} / ${(st.total / 1e9).toFixed(2)} Go` : (st.percent != null ? ` ${st.percent} %` : ''));
      });
      try {
        const r = await call(A.engine.setup());
        state.settings = r.settings; renderEngine();
        body.replaceChildren(el('h2', { text: 'Ton adjoint IA est prêt ✓' }), el('p', { text: `Modèle ${r.model} installé et vérifié sur une image. Il démarrera avec l’adjoint.` }),
          el('div', { class: 'wiz-actions' }, el('button', { class: 'btn', text: 'Fermer', onclick: () => { $('wizard').hidden = true; } }), el('button', { class: 'btn primary big', text: 'Démarrer le coach en direct', onclick: async () => { $('wizard').hidden = true; if (!state.live.on) await toggleLive(); } })));
      } catch (e) {
        txt.replaceChildren(el('span', { class: 'bad', text: (KIND_TITLES[e.kind] || 'Erreur') + ' — ' + e.message }));
        go.disabled = false; go.textContent = 'Réessayer'; later.disabled = false; gem.disabled = false; cancel.hidden = true;
      } finally { off(); state.setupRunning = false; }
    };
  }
  async function maybeOfferSetup() {
    if (state.settings.provider !== 'ollama') return;
    const st = await call(A.ollama.status()).catch(() => null);
    if (!st) return;
    const ready = st.installed && st.models.length > 0 && state.settings.ollamaModel;
    if (ready) { if (!st.running) call(A.ollama.start()).catch(() => {}); return; }
    openWizard(true);
  }

  if (new URLSearchParams(location.search).has('smoke')) window.__fm27 = { feedAdd, openWizard, closeWizard: () => { $('wizard').hidden = true; } };

  // ---------- événements ----------
  $('cap-fm').onclick = () => addCapture(A.capture.fm());
  $('cap-import').onclick = () => addCapture(A.capture.importFiles());
  $('cap-win').onclick = () => $('win-select').value && addCapture(A.capture.window($('win-select').value));
  $('cap-screen').onclick = () => addCapture(A.capture.screen($('screen-select').value));
  $('win-refresh').onclick = refreshWindows;
  $('cap-clear').onclick = async () => { await A.capture.clear(); state.images = []; renderThumbs(); };
  $('analyze').onclick = analyze;
  $('live-toggle').onclick = toggleLive;
  $('feed-clear').onclick = () => { state.live.items = []; renderFeed(); };
  A.live.onUpdate(onLive);
  $('cancel').onclick = () => A.cancelAnalyze();
  $('question').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) analyze(); });
  $('question').addEventListener('input', () => { state.drafts[state.section] = $('question').value; });
  $('engine-pill').onclick = () => openSettings();
  $('btn-settings').onclick = () => openSettings();
  $('btn-history').onclick = openHistory;
  $('drawer-close').onclick = closeDrawer;
  $('drawer').addEventListener('click', (e) => { if (e.target === $('drawer')) closeDrawer(); });
  $('lightbox').onclick = () => { $('lightbox').hidden = true; };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('lightbox').hidden = true; if (!$('drawer').hidden) closeDrawer(); } });
  $('career').addEventListener('change', async () => { state.settings = await call(A.settings.set({ career: careerName() })); state.lastReport = null; renderThread(); showReportFor(state.section); });
  $('copy').onclick = async () => { if (!state.lastReport) return; await navigator.clipboard.writeText(state.lastReport.answer); toast('Rapport copié.'); };
  $('export').onclick = async () => { if (state.lastReport) await A.exportReport(state.lastReport.answer, careerName()); };
  $('watch').onchange = async (e) => { await A.watch.set(e.target.checked); toast(e.target.checked ? 'Surveillance activée : aucune donnée n’est envoyée automatiquement.' : 'Surveillance désactivée.'); if (!e.target.checked) $('watch-toast').hidden = true; };
  $('watch-add').onclick = async () => { await addCapture(A.watch.adopt()); $('watch-toast').hidden = true; };
  $('watch-dismiss').onclick = () => { $('watch-toast').hidden = true; };

  A.capture.onAdded((im) => { state.images.push(im); renderThumbs(); toast('Capture ajoutée par raccourci.'); });
  A.capture.onError((e) => toast(e.message, true));
  A.watch.onChange((w) => {
    if (w.error) { if (w.error !== state.lastWatch) { toast(w.error, true); state.lastWatch = w.error; } return; }
    $('watch-img').src = w.thumb; $('watch-toast').hidden = false;
  });
  A.update.onState(onUpdate);
  init().catch((e) => { document.body.prepend(el('div', { class: 'banner', text: 'Erreur de démarrage : ' + e.message })); });
})();
