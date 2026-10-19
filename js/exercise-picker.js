// FORGE · unified exercise picker (v0.8.0)
// One picker used by the routine editor and the active workout.
// Two sources: YOUR LIBRARY (IndexedDB) and CATALOG (data/catalog.json,
// public-domain free-exercise-db). Picking a catalog exercise copies it
// into your library first. "+ CREATE CUSTOM" makes a new exercise inline.
import * as db from './db.js?v=23';
import { el, catBadge, toast, uid, CATEGORIES } from './ui.js?v=23';
import { inferFocus, inferCardioMachine, inferConstraints } from './import.js?v=23';

const MAX_ROWS = 150;
let _catalog = null;

export async function loadCatalog() {
  if (_catalog) return _catalog;
  const res = await fetch('data/catalog.json?v=23');
  if (!res.ok) throw new Error('Catalog not available');
  _catalog = await res.json();
  return _catalog;
}

const MUSCLE_FOCUS = {
  abdominals: 'core',
  chest: 'push', shoulders: 'push', triceps: 'push',
  lats: 'pull', 'middle back': 'pull', biceps: 'pull', traps: 'pull', 'lower back': 'pull', forearms: 'pull', neck: 'pull',
  quadriceps: 'legs', hamstrings: 'legs', glutes: 'legs', calves: 'legs', adductors: 'legs', abductors: 'legs',
};

export function catalogToExercise(c) {
  const nowIso = new Date().toISOString();
  const primary = c.pm || [];
  let category = 'strength';
  if (c.cat === 'stretching') category = 'mobility';
  else if (c.cat === 'cardio') category = 'cardio';
  else if (primary.includes('abdominals')) category = 'core';
  let focus = inferFocus(c.name);
  if (focus === 'other') {
    if (category === 'mobility') focus = 'mobility';
    else if (category === 'cardio') focus = 'cardio';
    else focus = MUSCLE_FOCUS[primary[0]] || 'other';
  }
  return {
    id: c.id,
    name: c.name,
    category,
    focus,
    cardioMachine: category === 'cardio' ? inferCardioMachine(c.name) : null,
    primaryMuscles: primary,
    secondaryMuscles: c.sm || [],
    equipment: c.eq || '',
    instructions: c.ins || [],
    isCustom: false,
    source: 'catalog',
    notes: '',
    substituteIds: [],
    constraintFlags: inferConstraints(c.name),
    hevyTemplateId: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

// Opens the picker. onPick(exercise) receives a library exercise record.
export async function openExercisePicker(title, onPick, opts = {}) {
  const activeFlags = opts.activeFlags || [];
  let library = await db.getAll('exercises');
  let tab = 'library';
  let query = '';

  const scrim = document.getElementById('inspector-scrim');
  document.getElementById('inspector-title').textContent = title;
  const body = document.getElementById('inspector-body');
  body.innerHTML = '';

  const close = () => { scrim.hidden = true; };
  const done = (ex) => { close(); onPick(ex); };

  const libTab = el('button', { class: 'picker-tab picker-tab-active' });
  const catTab = el('button', { class: 'picker-tab' });
  const tabs = el('div', { class: 'picker-tabs' }, [libTab, catTab]);
  const search = el('input', { class: 'search-input picker-search', type: 'search', placeholder: 'SEARCH EXERCISES...' });
  const createBtn = el('button', { class: 'btn btn-outline picker-create-btn' }, [
    el('span', { class: 'btn-title', text: '+ CREATE CUSTOM EXERCISE' }),
  ]);
  const createWrap = el('div', { class: 'picker-create', hidden: true });
  const list = el('div', { class: 'picker-list' });
  const head = el('div', { class: 'picker-head' }, [tabs, search, createBtn, createWrap]);
  body.appendChild(head);
  body.appendChild(list);

  function setTabLabels() {
    libTab.textContent = `YOUR LIBRARY · ${library.length}`;
    catTab.textContent = `CATALOG · ${_catalog ? _catalog.length : '…'}`;
  }

  function row(main, sub, badge, right, onClick, dim = false) {
    return el('button', { class: 'picker-row' + (dim ? ' picker-row-dim' : ''), onclick: onClick }, [
      badge || el('span', { class: 'picker-row-spacer' }),
      el('div', { class: 'picker-row-main' }, [
        el('div', { class: 'picker-row-name', text: main }),
        sub ? el('div', { class: 'picker-row-sub', text: sub }) : null,
      ]),
      right ? el('span', { class: 'picker-row-right', text: right }) : null,
    ]);
  }

  async function renderList() {
    list.innerHTML = '';
    const q = query.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    const matches = (name) => words.every((w) => name.toLowerCase().includes(w));

    if (tab === 'library') {
      const items = library.filter((e) => matches(e.name || ''))
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      if (items.length === 0) {
        list.appendChild(el('div', { class: 'picker-empty', text: q ? 'NOT IN YOUR LIBRARY · TRY CATALOG OR CREATE CUSTOM' : 'LIBRARY IS EMPTY' }));
        return;
      }
      for (const ex of items.slice(0, MAX_ROWS)) {
        const flagged = (ex.constraintFlags || []).some((f) => activeFlags.includes(f));
        list.appendChild(row(ex.name, ex.equipment || '', catBadge(ex), flagged ? '⚑' : null, () => done(ex)));
      }
      if (items.length > MAX_ROWS) list.appendChild(el('div', { class: 'picker-empty', text: `${items.length - MAX_ROWS} MORE · REFINE YOUR SEARCH` }));
      return;
    }

    // Catalog
    let catalog;
    try { catalog = await loadCatalog(); }
    catch (err) {
      list.appendChild(el('div', { class: 'picker-empty', text: 'CATALOG COULD NOT LOAD · CHECK YOUR CONNECTION' }));
      return;
    }
    setTabLabels();
    if (tab !== 'catalog') return;
    const byName = new Map(library.map((e) => [(e.name || '').toLowerCase(), e]));
    const items = catalog.filter((c) => matches(c.name));
    if (items.length === 0) {
      list.appendChild(el('div', { class: 'picker-empty', text: 'NO MATCH IN CATALOG · CREATE CUSTOM BELOW SEARCH' }));
      return;
    }
    for (const c of items.slice(0, MAX_ROWS)) {
      const owned = byName.get(c.name.toLowerCase()) || library.find((e) => e.id === c.id);
      const sub = [c.eq, (c.pm || [])[0]].filter(Boolean).join(' · ').toUpperCase();
      list.appendChild(row(c.name, sub, null, owned ? '✓ IN LIBRARY' : '+', async () => {
        if (owned) { done(owned); return; }
        const ex = catalogToExercise(c);
        try {
          await db.put('exercises', ex);
          toast(`ADDED TO LIBRARY · ${ex.name}`, 'ok');
          done(ex);
        } catch (err) { console.error(err); toast('ADD FAILED · ' + err.message, 'error'); }
      }, !!owned));
    }
    if (items.length > MAX_ROWS) list.appendChild(el('div', { class: 'picker-empty', text: `${items.length - MAX_ROWS} MORE · REFINE YOUR SEARCH` }));
  }

  function selectTab(t) {
    tab = t;
    libTab.classList.toggle('picker-tab-active', t === 'library');
    catTab.classList.toggle('picker-tab-active', t === 'catalog');
    renderList();
  }
  libTab.addEventListener('click', () => selectTab('library'));
  catTab.addEventListener('click', () => selectTab('catalog'));
  search.addEventListener('input', () => { query = search.value; renderList(); });

  // Inline create form
  createBtn.addEventListener('click', () => {
    if (!createWrap.hidden) { createWrap.hidden = true; return; }
    createWrap.innerHTML = '';
    const nameIn = el('input', { class: 'form-input', type: 'text', placeholder: 'EXERCISE NAME', value: search.value.trim() });
    const catSel = el('select', { class: 'form-input form-select' });
    for (const c of CATEGORIES) {
      const o = document.createElement('option'); o.value = c; o.textContent = c.toUpperCase(); catSel.appendChild(o);
    }
    const eqIn = el('input', { class: 'form-input', type: 'text', placeholder: 'EQUIPMENT (OPTIONAL)' });
    const save = el('button', { class: 'btn btn-primary' }, [ el('span', { class: 'btn-title', text: 'CREATE + ADD' }) ]);
    save.addEventListener('click', async () => {
      const name = nameIn.value.trim();
      if (!name) { toast('NAME REQUIRED', 'error'); return; }
      const category = catSel.value;
      const nowIso = new Date().toISOString();
      const ex = {
        id: uid('cu'), name, category,
        focus: category === 'cardio' ? 'cardio' : category === 'mobility' ? 'mobility' : category === 'rehab' ? 'rehab' : category === 'core' ? 'core' : inferFocus(name),
        cardioMachine: category === 'cardio' ? inferCardioMachine(name) : null,
        primaryMuscles: [], secondaryMuscles: [],
        equipment: eqIn.value.trim(),
        isCustom: true, notes: '', substituteIds: [],
        constraintFlags: inferConstraints(name),
        hevyTemplateId: null, createdAt: nowIso, updatedAt: nowIso,
      };
      try {
        await db.put('exercises', ex);
        toast(`CREATED · ${name}`, 'ok');
        done(ex);
      } catch (err) { console.error(err); toast('CREATE FAILED · ' + err.message, 'error'); }
    });
    createWrap.appendChild(el('div', { class: 'form-stack' }, [
      el('label', { class: 'form-field' }, [ el('span', { class: 'form-label', text: 'NAME' }), nameIn ]),
      el('label', { class: 'form-field' }, [ el('span', { class: 'form-label', text: 'CATEGORY' }), catSel ]),
      el('label', { class: 'form-field' }, [ el('span', { class: 'form-label', text: 'EQUIPMENT' }), eqIn ]),
      save,
    ]));
    createWrap.hidden = false;
    nameIn.focus();
  });

  setTabLabels();
  scrim.hidden = false;
  if (opts.startTab === 'catalog') selectTab('catalog'); else renderList();
  loadCatalog().then(setTabLabels).catch(() => {});
}
