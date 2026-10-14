/* SPIKE Blocks -> Python : page logic */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const C = window.SpikeConverter;
  const state = { project: null, name: 'program', res: null, pythonOnly: null };
  let blockEls = new Map(), lineEls = new Map(), current = null;

  // ---------- small helpers
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } }
  };
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function toast(msg) {
    let t = document.querySelector('.toast');
    if (!t) { t = el('div', 'toast'); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 1600);
  }
  function showError(msg) { const e = $('error'); e.textContent = msg; e.style.display = 'block'; }
  function safeName(s) { return String(s || 'program').replace(/[^\w\- ]+/g, '_').trim() || 'program'; }
  function save(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ---------- loading
  async function loadFile(file) {
    if (!file) return;
    $('error').style.display = 'none';
    if (!/\.llsp3?$/i.test(file.name)) return showError('Please choose a SPIKE project file ending in .llsp3');
    try {
      const p = await C.readProject(await file.arrayBuffer(), file.name);
      state.name = p.name;
      if (p.alreadyPython) { state.project = null; state.pythonOnly = p.python; }
      else { state.project = p.project; state.pythonOnly = null; }
      run();
    } catch (e) {
      console.error(e);
      showError(e.message || 'Something went wrong reading that file.');
    }
  }

  function loadExample() {
    state.project = JSON.parse(JSON.stringify(window.SPIKE_EXAMPLE.project));
    state.name = window.SPIKE_EXAMPLE.name;
    state.pythonOnly = null;
    $('error').style.display = 'none';
    run();
  }

  function run() {
    if (state.pythonOnly != null) {
      state.res = { python: state.pythonOnly, lineIds: [], todos: [], notes: ['This file is already a Python project, so here is its code as-is.'], stacks: [], stats: { blocks: 0, stacks: 0 } };
    } else {
      state.res = C.convertProject(state.project, { name: state.name, explain: $('explain').checked });
    }
    render();
  }

  // ---------- rendering
  function render() {
    const res = state.res;
    $('start').hidden = true;
    $('result').hidden = false;
    $('title').textContent = state.name;
    document.title = state.name + ' → Python';

    const chips = $('chips'); chips.textContent = '';
    if (state.pythonOnly == null) {
      chips.appendChild(el('span', 'chip', res.stats.blocks + ' blocks'));
      chips.appendChild(el('span', 'chip', res.stats.stacks + (res.stats.stacks === 1 ? ' script' : ' scripts')));
      const todoCount = uniqTodos(res.todos).length;
      if (todoCount) {
        const w = el('span', 'chip warn', '⚠ ' + todoCount + (todoCount === 1 ? ' needs a look' : ' need a look'));
        w.onclick = () => $('todos').scrollIntoView({ behavior: 'smooth', block: 'center' });
        chips.appendChild(w);
      } else chips.appendChild(el('span', 'chip ok', '✓ every block converted'));
    } else chips.appendChild(el('span', 'chip', 'already Python'));

    renderBlocks(res.stacks);
    renderCode(res.python, res.lineIds);
    renderTodos(res);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function uniqTodos(todos) {
    const seen = new Set();
    return (todos || []).filter((t) => { const k = t.msg + '|' + t.id; if (seen.has(k)) return false; seen.add(k); return true; });
  }

  function renderBlocks(stacks) {
    const canvas = $('canvas');
    canvas.textContent = '';
    blockEls = new Map();
    if (!stacks || !stacks.length) {
      canvas.appendChild(el('p', 'stack-note', state.pythonOnly != null ? 'This project has no blocks; it was written in Python.' : 'No blocks found.'));
      return;
    }
    for (const s of stacks) {
      if (!s.blocks.length) continue;
      const wrap = el('div', 'stack' + (s.loose ? ' loose' : ''));
      if (s.loose) wrap.appendChild(el('div', 'stack-note', 'Not under a “when” block, so it never runs (skipped)'));
      for (const n of s.blocks) wrap.appendChild(stmt(n));
      canvas.appendChild(wrap);
      canvas.appendChild(document.createElement('br'));
    }
  }

  function color(cat) { return (C.CATS && C.CATS[cat]) || '#888'; }

  function stmt(n) {
    if (!n) return el('span');
    if (n.shape === 'c') {
      const w = el('div', 'cwrap');
      w.style.setProperty('--c', color(n.cat));
      const top = el('div', 'blk' + (n.todo ? ' todo' : ''));
      top.style.setProperty('--c', color(n.cat));
      fillParts(top, n.parts);
      w.appendChild(top);
      const body = el('div', 'cbody');
      for (const c of n.sub || []) body.appendChild(stmt(c));
      w.appendChild(body);
      if (n.sub2) {
        w.appendChild(el('div', 'cmid', 'else'));
        const body2 = el('div', 'cbody');
        for (const c of n.sub2) body2.appendChild(stmt(c));
        w.appendChild(body2);
      }
      w.appendChild(el('div', 'cfoot' + (n.cap ? ' cap' : '')));
      register(w, n.id);
      return w;
    }
    const b = el('div', 'blk' + (n.shape === 'hat' ? ' hat' : '') + (n.todo ? ' todo' : ''));
    b.style.setProperty('--c', color(n.cat));
    fillParts(b, n.parts);
    register(b, n.id);
    return b;
  }

  function register(e, id) {
    if (!id) return;
    e.dataset.sid = id;
    blockEls.set(id, e);
  }

  function fillParts(host, parts) {
    for (const p of parts || []) {
      if (typeof p === 'string') { host.appendChild(el('span', null, p)); continue; }
      if (p.k === 'node' && p.node) { host.appendChild(reporter(p.node)); continue; }
      if (p.k === 'bool') { host.appendChild(el('span', 'in bool')); continue; }
      if (p.k === 'empty') { host.appendChild(el('span', 'in', ' ')); continue; }
      host.appendChild(el('span', 'in ' + (p.k === 'menu' ? 'menu' : p.k === 'text' ? 'text' : 'num'), p.v === '' ? ' ' : p.v));
    }
  }

  function reporter(n) {
    const r = el('span', 'rep' + (n.shape === 'boolean' ? ' boolean' : '') + (n.todo ? ' todo' : ''));
    r.style.setProperty('--c', color(n.cat));
    fillParts(r, n.parts);
    return r;
  }

  function renderCode(python, lineIds) {
    const code = $('code');
    code.textContent = '';
    lineEls = new Map();
    const lines = python.replace(/\n$/, '').split('\n');
    lines.forEach((text, i) => {
      const d = el('div', 'ln');
      const t = el('span', 't');
      d.appendChild(t);
      const id = lineIds && lineIds[i];
      if (window.hljs && text.trim()) {
        try { t.innerHTML = hljs.highlight(text, { language: 'python', ignoreIllegals: true }).value; } catch (e) { t.textContent = text; }
      } else t.textContent = text || ' ';
      if (/^\s*# ▸/.test(text)) d.classList.add('explain');
      if (/# TODO/.test(text)) d.classList.add('todo-line');
      if (id) {
        d.dataset.id = id;
        if (!lineEls.has(id)) lineEls.set(id, []);
        lineEls.get(id).push(d);
      }
      code.appendChild(d);
    });
    // blocks that became settings written into other lines
    for (const [id, e] of blockEls) {
      if (!lineEls.has(id)) e.title = 'No line of its own: this value is written straight into the Python where it is used (e.g. velocity=300).';
    }
  }

  function renderTodos(res) {
    const box = $('todos');
    box.textContent = '';
    const todos = uniqTodos(res.todos);
    if (todos.length) {
      const t = el('div', 'todos');
      t.appendChild(el('b', null, todos.length + (todos.length === 1 ? ' block needs' : ' blocks need') + ' a look'));
      t.appendChild(el('span', null, 'These are marked # TODO in the code. Click one to find it:'));
      const ul = el('ul');
      for (const td of todos) {
        const li = el('li', null, td.msg);
        li.onclick = () => focusId(td.id, 'block', true);
        ul.appendChild(li);
      }
      t.appendChild(ul);
      box.appendChild(t);
    }
    if (res.notes && res.notes.length) {
      const n = el('div', 'notes');
      for (const s of res.notes) n.appendChild(el('div', null, 'ℹ︎ ' + s));
      box.appendChild(n);
    }
  }

  // ---------- linking blocks <-> python
  function highlight(id) {
    if (current === id) return;
    clearHighlight();
    current = id;
    if (!id) return;
    const b = blockEls.get(id); if (b) b.classList.add('hl');
    for (const l of lineEls.get(id) || []) l.classList.add('hl');
  }
  function clearHighlight() {
    if (!current) return;
    const b = blockEls.get(current); if (b) b.classList.remove('hl');
    for (const l of lineEls.get(current) || []) l.classList.remove('hl');
    current = null;
  }
  function scrollInto(container, target) {
    if (!container || !target) return;
    const c = container.getBoundingClientRect(), t = target.getBoundingClientRect();
    if (t.top < c.top + 10 || t.bottom > c.bottom - 10) {
      container.scrollBy({ top: t.top - c.top - c.height / 3, behavior: 'smooth' });
    }
    if (t.left < c.left || t.right > c.right) container.scrollBy({ left: t.left - c.left - 20, behavior: 'smooth' });
  }
  function isMobile() { return window.matchMedia('(max-width: 860px)').matches; }
  function focusId(id, side, scrollPage) {
    if (!id) return;
    highlight(id);
    if (side === 'block') {
      if (isMobile()) showTab('blocks');
      const b = blockEls.get(id);
      if (b) { if (scrollPage) $('panes').scrollIntoView({ behavior: 'smooth', block: 'start' }); scrollInto($('canvas'), b); }
    } else {
      if (isMobile()) showTab('code');
      const l = (lineEls.get(id) || [])[0];
      if (l) scrollInto($('code'), l);
    }
  }

  $('canvas').addEventListener('mouseover', (e) => {
    const t = e.target.closest('[data-sid]');
    highlight(t ? t.dataset.sid : null);
  });
  $('canvas').addEventListener('mouseleave', () => clearHighlight());
  $('canvas').addEventListener('click', (e) => {
    const t = e.target.closest('[data-sid]');
    if (t) { e.stopPropagation(); focusId(t.dataset.sid, 'code'); }
  });
  $('code').addEventListener('mouseover', (e) => {
    const t = e.target.closest('.ln[data-id]');
    highlight(t ? t.dataset.id : null);
  });
  $('code').addEventListener('mouseleave', () => clearHighlight());
  $('code').addEventListener('click', (e) => {
    const t = e.target.closest('.ln[data-id]');
    if (t) focusId(t.dataset.id, 'block');
  });

  // ---------- tabs (phones)
  function showTab(name) {
    $('panes').dataset.show = name;
    for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('on', b.dataset.tab === name);
  }
  for (const b of document.querySelectorAll('.tabs button')) b.addEventListener('click', () => showTab(b.dataset.tab));
  showTab('blocks');

  // ---------- controls
  const drop = $('drop'), fileInput = $('file');
  fileInput.addEventListener('change', () => { loadFile(fileInput.files[0]); fileInput.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => { if (ev === 'drop' || !e.relatedTarget) drop.classList.remove('over'); }));
  document.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer && e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  $('example').addEventListener('click', loadExample);
  $('again').addEventListener('click', () => {
    $('result').hidden = true; $('start').hidden = false;
    document.title = 'SPIKE Blocks → Python';
    window.scrollTo({ top: 0 });
  });

  const explain = $('explain');
  explain.checked = store.get('explain') === '1';
  explain.addEventListener('change', () => {
    store.set('explain', explain.checked ? '1' : '0');
    if (state.project) run();
  });

  $('copy').addEventListener('click', async () => {
    const text = state.res ? state.res.python : '';
    try { await navigator.clipboard.writeText(text); }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy'); ta.remove();
    }
    const btn = $('copy');
    btn.textContent = 'Copied!';
    setTimeout(() => (btn.textContent = 'Copy code'), 1500);
  });

  $('download').addEventListener('click', () => {
    save(new Blob([state.res.python], { type: 'text/x-python' }), safeName(state.name) + '.py');
  });

  $('llsp3').addEventListener('click', async () => {
    try {
      const blob = await C.makePythonProject(state.res.python, state.name);
      save(blob, safeName(state.name) + ' (Python).llsp3');
      toast('Saved! Open it in the SPIKE App');
    } catch (e) { console.error(e); toast('Could not build the project file'); }
  });
})();
