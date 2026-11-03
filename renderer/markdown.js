// Analyse Markdown minimale et SÛRE : on produit un arbre, jamais de HTML brut.
(function (root) {
  function inline(text) {
    const out = [];
    const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push({ t: 'text', v: text.slice(last, m.index) });
      const tok = m[0];
      if (tok.startsWith('**')) out.push({ t: 'strong', v: tok.slice(2, -2) });
      else if (tok.startsWith('`')) out.push({ t: 'code', v: tok.slice(1, -1) });
      else out.push({ t: 'em', v: tok.slice(1, -1) });
      last = m.index + tok.length;
    }
    if (last < text.length) out.push({ t: 'text', v: text.slice(last) });
    return out;
  }

  function parse(src) {
    const blocks = [];
    let list = null;
    const flush = () => { if (list) { blocks.push(list); list = null; } };
    for (const raw of String(src || '').replace(/\r\n?/g, '\n').split('\n')) {
      const line = raw.trimEnd();
      if (!line.trim()) { flush(); continue; }
      let m;
      if ((m = /^\s{0,3}(#{1,4})\s+(.*)$/.exec(line))) { flush(); blocks.push({ t: 'h', level: Math.min(m[1].length + 1, 4), text: m[2].replace(/\*\*/g, '').replace(/:$/, '') }); continue; }
      if ((m = /^\s*[-*•]\s+(.*)$/.exec(line))) { if (!list || list.ordered) { flush(); list = { t: 'list', ordered: false, items: [] }; } list.items.push(inline(m[1])); continue; }
      if ((m = /^\s*(\d+)[.)]\s+(.*)$/.exec(line))) { if (!list || !list.ordered) { flush(); list = { t: 'list', ordered: true, items: [] }; } list.items.push(inline(m[2])); continue; }
      if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { flush(); blocks.push({ t: 'hr' }); continue; }
      // Titre « Faits lus : » écrit en gras seul sur une ligne
      if ((m = /^\*\*([^*]+?):?\*\*:?$/.exec(line.trim()))) { flush(); blocks.push({ t: 'h', level: 3, text: m[1] }); continue; }
      flush();
      blocks.push({ t: 'p', children: inline(line.trim()) });
    }
    flush();
    return blocks;
  }

  function tone(title) {
    const s = title.toLowerCase();
    if (/correction/.test(s)) return 'good';
    if (/incertain|illisible|manquant|écrans à fournir|informations manquantes/.test(s)) return 'warn';
    if (/hypoth/.test(s)) return 'info';
    if (/fait/.test(s)) return 'facts';
    return '';
  }

  function render(doc, text) {
    const frag = doc.createDocumentFragment();
    let section = null;
    const target = () => section || frag;
    const addInline = (el, kids) => {
      for (const k of kids) {
        if (k.t === 'text') el.appendChild(doc.createTextNode(k.v));
        else { const n = doc.createElement(k.t === 'code' ? 'code' : k.t); n.textContent = k.v; el.appendChild(n); }
      }
    };
    for (const b of parse(text)) {
      if (b.t === 'h') {
        section = doc.createElement('section');
        section.className = 'rep-sec ' + tone(b.text);
        const h = doc.createElement('h' + b.level); h.textContent = b.text;
        section.appendChild(h); frag.appendChild(section);
      } else if (b.t === 'p') { const p = doc.createElement('p'); addInline(p, b.children); target().appendChild(p); }
      else if (b.t === 'list') {
        const l = doc.createElement(b.ordered ? 'ol' : 'ul');
        for (const it of b.items) { const li = doc.createElement('li'); addInline(li, it); l.appendChild(li); }
        target().appendChild(l);
      } else if (b.t === 'hr') target().appendChild(doc.createElement('hr'));
    }
    return frag;
  }

  const api = { parse, render, tone };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Markdown = api;
})(typeof window !== 'undefined' ? window : globalThis);
