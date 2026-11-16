// FORGE v1.0.0 · PLAN tab: program phases, blocks, daily routines, scheduling
import * as db from './db.js?v=27';
import {
  el, section, notFound, catBadge, focusTagEl, routineTags, toast, confirmModal, getActiveSession, todayIso, formatDuration,
} from './ui.js?v=27';
import {
  PHASES, phaseById, currentPhase, phaseCountdown, phaseBlocks, routinesOn, scheduleSummary,
  weekDates, shortDate, dayKeyOfIso, parseIso, CAT_LABEL,
} from './program.js?v=27';

const BLOCK_ORDER = ['pull', 'legs', 'push', 'core', 'cardio', 'rehab'];

// ---------- Shared bottom-sheet (uses the inspector modal) ----------
export function openSheet(title, bodyEl) {
  document.getElementById('inspector-title').textContent = title;
  const body = document.getElementById('inspector-body');
  body.innerHTML = '';
  body.appendChild(bodyEl);
  document.getElementById('inspector-scrim').hidden = false;
}
export function closeSheet() { document.getElementById('inspector-scrim').hidden = true; }
async function refresh() { const m = await import('./app.js?v=27'); m.refresh && m.refresh(); }

// ---------- PLAN ----------
export async function renderPlan(container, params) {
  const today = todayIso();
  const cur = currentPhase(today);
  const sel = phaseById(params && params[0]) || cur;
  const [routines, exercises] = await Promise.all([db.getAll('routines'), db.getAll('exercises')]);
  const exById = new Map(exercises.map((e) => [e.id, e]));
  const active = routines.filter((r) => r.isActive !== false);

  container.appendChild(el('section', { class: 'hero' }, [
    el('div', { class: 'eyebrow', text: 'PROGRAM  ·  ROAD TO THE INCA TRAIL' }),
    el('h1', { text: 'PLAN' }),
  ]));

  // Phase strip
  const strip = el('div', { class: 'phase-strip' });
  PHASES.forEach((p, i) => {
    strip.appendChild(el('a', {
      class: `phase-chip phase-chip-${i + 1}` + (p.id === sel.id ? ' phase-chip-on' : '') + (p.id === cur.id ? ' phase-chip-current' : ''),
      href: `#/plan/${p.id}`,
    }, [ el('span', { class: 'phase-chip-name', text: p.name }), el('span', { class: 'phase-chip-dates', text: p.dates }) ]));
  });
  container.appendChild(section(null, strip));

  // Countdown + description
  const cd = phaseCountdown(sel, today);
  const cdChildren = [
    el('div', { class: 'countdown-main' }, [
      el('div', { class: 'countdown-title', text: `${sel.name}${sel.id === cur.id && cd && !cd.startsIn ? '  ·  NOW' : ''}` }),
      el('div', { class: 'countdown-sub', text: sel.where }),
    ]),
  ];
  if (cd) {
    const when = cd.startsIn === 1 ? 'STARTS TOMORROW' : cd.startsIn > 1 ? `STARTS IN ${cd.startsIn} DAYS` : null;
    cdChildren.push(el('div', { class: 'countdown-num' }, [
      el('div', { class: 'countdown-days', text: String(cd.daysLeft) }),
      el('div', { class: 'countdown-unit', text: cd.daysLeft === 0 ? 'FINISHED' : cd.daysLeft === 1 ? 'DAY LEFT' : 'DAYS LEFT' }),
      when ? el('div', { class: 'countdown-when', text: when }) : null,
    ]));
  }
  container.appendChild(section('COUNTDOWN', el('div', { class: `countdown-card countdown-${PHASES.indexOf(sel) + 1}` }, cdChildren)));

  // Blocks
  const blocks = await phaseBlocks(sel.id);
  if (!blocks) {
    container.appendChild(section(`${sel.name} BLOCKS`, el('div', { class: 'note-block', text: sel.placeholder || 'Details to be added.' })));
  } else {
    const list = el('div', { class: 'block-list' });
    for (const cat of BLOCK_ORDER) {
      if (!(cat in blocks)) continue;
      const n = blocks[cat].length;
      list.appendChild(el('a', { class: 'block-row', href: `#/block/${sel.id}/${cat}` }, [
        catBadge(cat),
        el('div', { class: 'block-row-main' }, [
          el('div', { class: 'block-row-title', text: n ? `${n} EXERCISE${n === 1 ? '' : 'S'}` : 'NO EXERCISES YET' }),
          n ? null : el('div', { class: 'block-row-sub', text: 'ADD YOUR PT EXERCISES TO A ROUTINE FROM THE LIBRARY' }),
        ]),
        el('div', { class: 'nav-row-arrow', text: '›' }),
      ]));
    }
    container.appendChild(section(`${sel.name} BLOCKS  ·  COMBINE INTO DAILY ROUTINES`, list));
  }

  // Daily routines for this phase (+ routines with no phase)
  const phaseRoutines = active.filter((r) => r.phaseId === sel.id || !r.phaseId);
  const rList = el('div', { class: 'day-list' });
  if (phaseRoutines.length === 0) rList.appendChild(el('div', { class: 'empty-note', text: 'NO ROUTINES YET · BUILD ONE FROM THE BLOCKS ABOVE' }));
  for (const r of phaseRoutines) rList.appendChild(routineListRow(r, exById));
  rList.appendChild(el('a', { class: 'btn btn-primary', href: `#/routine/new/${sel.id}`, style: 'margin-top: 10px;' }, [
    el('span', { class: 'btn-title', text: '+ BUILD ROUTINE' }),
    el('span', { class: 'btn-sub', text: 'PICK FROM BLOCKS OR THE LIBRARY' }),
  ]));
  container.appendChild(section('DAILY ROUTINES', rList));

  // This week
  const week = weekDates(today);
  const wList = el('div', { class: 'week-list' });
  for (const d of week) {
    const rs = routinesOn(active, d);
    const isToday = d === today;
    const row = el('div', { class: 'week-row' + (isToday ? ' week-row-today' : '') }, [
      el('div', { class: 'week-row-day' }, [
        el('div', { class: 'week-row-dow', text: dayKeyOfIso(d).toUpperCase() }),
        el('div', { class: 'week-row-date', text: shortDate(d) }),
      ]),
      el('div', { class: 'week-row-main' }, rs.length
        ? rs.map((r) => el('a', { class: 'week-row-routine', href: `#/routine/${r.id}` }, [
          el('span', { text: r.name }),
          el('span', { class: 'tag-row' }, routineTags(r, exById).map(focusTagEl)),
        ]))
        : [el('span', { class: 'week-row-empty', text: 'NOTHING PLANNED' })]),
      el('button', { class: 'week-row-add', text: '+', 'aria-label': `Add a routine on ${shortDate(d)}`, onclick: () => openAddToDate(d, active) }),
    ]);
    wList.appendChild(row);
  }
  container.appendChild(section('THIS WEEK', wList));

  // Actions
  container.appendChild(section('ACTIONS', el('div', { class: 'action-grid' }, [
    el('button', { class: 'btn btn-outline', onclick: onQuickWorkout }, [ el('span', { class: 'btn-title', text: 'QUICK WORKOUT' }), el('span', { class: 'btn-sub', text: 'OFF-PLAN SESSION' }) ]),
    el('button', { class: 'btn btn-outline', onclick: () => openLogPast(active) }, [ el('span', { class: 'btn-title', text: 'LOG PAST WORKOUT' }), el('span', { class: 'btn-sub', text: 'FORGOT TO LOG? PICK A DATE' }) ]),
    el('a', { class: 'btn btn-outline', href: `#/routine/new/${sel.id}` }, [ el('span', { class: 'btn-title', text: 'NEW ROUTINE' }), el('span', { class: 'btn-sub', text: 'BUILD FROM BLOCKS' }) ]),
    el('a', { class: 'btn btn-outline', href: '#/library' }, [ el('span', { class: 'btn-title', text: 'EXERCISE LIBRARY' }), el('span', { class: 'btn-sub', text: 'By category, A to Z' }) ]),
  ])));
}

function routineListRow(r, exById) {
  return el('div', { class: 'routine-row' }, [
    el('a', { class: 'routine-row-main', href: `#/routine/${r.id}` }, [
      el('div', { class: 'routine-row-title', text: r.name }),
      el('div', { class: 'tag-row' }, routineTags(r, exById).map(focusTagEl)),
      el('div', { class: 'routine-row-sub', text: `${(r.exercises || []).length} EXERCISES  ·  ${scheduleSummary(r)}` }),
    ]),
    el('button', { class: 'btn-mini', text: 'ADD TO DAY', onclick: () => openScheduleSheet(r) }),
  ]);
}

// ---------- BLOCK DETAIL ----------
export async function renderBlock(container, params) {
  const [phaseId, cat] = params;
  const ph = phaseById(phaseId);
  const blocks = ph ? await phaseBlocks(ph.id) : null;
  if (!blocks || !(cat in blocks)) { container.appendChild(notFound('BLOCK NOT FOUND', '#/plan', 'PLAN')); return; }
  const list = blocks[cat];
  const exById = new Map((await db.getAll('exercises')).map((e) => [e.id, e]));
  container.appendChild(el('section', { class: 'hero' }, [
    el('div', { class: 'eyebrow' }, [
      el('a', { href: `#/plan/${ph.id}`, class: 'crumb', text: '‹ PLAN' }),
      el('span', { text: `  ·  ${ph.name}  ·  ${ph.dates}` }),
    ]),
    el('h1', { text: CAT_LABEL[cat] }),
    el('div', { class: 'tag-row', style: 'margin-top: 8px;' }, [focusTagEl(cat)]),
  ]));
  if (list.length === 0) {
    container.appendChild(section('EXERCISES', el('div', { class: 'note-block', text: 'No exercises yet. Add your PT exercises to a routine from the library.' })));
    return;
  }
  const wrap = el('div', { class: 'exercise-list' });
  list.forEach((e, i) => {
    const alts = e.altIds.map((id) => exById.get(id)?.name).filter(Boolean);
    wrap.appendChild(el('a', { class: 'exercise-row exercise-row-link', href: `#/exercise/${e.exerciseId}` }, [
      el('div', { class: 'exercise-num', text: i + 1 }),
      catBadge(exById.get(e.exerciseId) || cat),
      el('div', { class: 'exercise-main' }, [
        el('div', { class: 'exercise-name', text: e.exerciseName }),
        el('div', { class: 'exercise-meta', text: e.target + (e.note ? `  ·  ${e.note.toUpperCase()}` : '') }),
        alts.length ? el('div', { class: 'exercise-alts', text: `Alternatives: ${alts.join(' · ')}` }) : null,
      ]),
      el('div', { class: 'nav-row-arrow', text: 'ⓘ' }),
    ]));
  });
  container.appendChild(section(`EXERCISES  ·  ${list.length}  ·  TAP FOR INSTRUCTIONS`, wrap));
}

// ---------- Block checklist (used by the routine editor) ----------
// Calls onAdd(entries[]) with the ticked block entries.
export async function openBlockPicker(phaseId, onAdd) {
  const ph = phaseById(phaseId) || currentPhase(todayIso());
  const blocks = await phaseBlocks(ph.id);
  const body = el('div', { class: 'block-picker' });
  if (!blocks) {
    body.appendChild(el('div', { class: 'note-block', text: `${ph.name} has no blocks yet. Use + ADD FROM LIBRARY instead.` }));
    openSheet('ADD FROM BLOCKS', body);
    return;
  }
  const checks = [];
  for (const cat of BLOCK_ORDER) {
    if (!(cat in blocks) || blocks[cat].length === 0) continue;
    const group = el('div', { class: 'block-group' });
    const boxes = [];
    const head = el('div', { class: 'block-group-head' }, [
      catBadge(cat),
      el('span', { class: 'block-group-title', text: `${CAT_LABEL[cat]}  ·  ${blocks[cat].length}` }),
      el('button', { class: 'btn-mini', text: 'ADD ALL', onclick: () => { const all = boxes.every((b) => b.checked); boxes.forEach((b) => { b.checked = !all; }); } }),
    ]);
    group.appendChild(head);
    for (const e of blocks[cat]) {
      const cb = el('input', { type: 'checkbox' });
      boxes.push(cb); checks.push({ cb, e });
      group.appendChild(el('label', { class: 'block-check' }, [
        cb,
        el('span', { class: 'block-check-main' }, [
          el('span', { class: 'block-check-name', text: e.exerciseName }),
          el('span', { class: 'block-check-meta', text: e.target }),
        ]),
      ]));
    }
    body.appendChild(group);
  }
  const addBtn = el('button', { class: 'btn btn-primary', style: 'margin-top: 12px;' }, [ el('span', { class: 'btn-title', text: 'ADD SELECTED' }) ]);
  addBtn.addEventListener('click', () => {
    const picked = checks.filter((c) => c.cb.checked).map((c) => c.e);
    if (picked.length === 0) { toast('TICK AT LEAST ONE EXERCISE', 'error'); return; }
    closeSheet();
    onAdd(picked);
  });
  body.appendChild(addBtn);
  openSheet(`ADD FROM ${ph.name} BLOCKS`, body);
}

// ---------- Schedule: repeat on weekdays and/or specific dates ----------
export function openScheduleSheet(routine) {
  const days = new Set(routine.scheduleDays && routine.scheduleDays.length ? routine.scheduleDays : (routine.scheduledDay ? [routine.scheduledDay] : []));
  const dates = new Set(routine.scheduleDates || []);
  const ph = routine.phaseId ? phaseById(routine.phaseId) : null;
  const body = el('div', { class: 'form-stack' });

  body.appendChild(el('div', { class: 'form-label', text: 'REPEAT EVERY WEEK ON' }));
  const dayRow = el('div', { class: 'weekday-row' });
  for (const d of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) {
    const b = el('button', { class: 'weekday-btn' + (days.has(d) ? ' weekday-btn-on' : ''), text: d.slice(0, 2).toUpperCase() });
    b.addEventListener('click', () => { if (days.has(d)) days.delete(d); else days.add(d); b.classList.toggle('weekday-btn-on'); });
    dayRow.appendChild(b);
  }
  body.appendChild(dayRow);
  if (ph && ph.end) body.appendChild(el('div', { class: 'form-hint', text: `REPEATS UNTIL ${ph.name} ENDS ON ${shortDate(ph.end)}.` }));

  body.appendChild(el('div', { class: 'form-label', style: 'margin-top: 8px;', text: 'OR ON SPECIFIC DATES' }));
  const dateList = el('div', { class: 'date-chip-row' });
  function renderDates() {
    dateList.innerHTML = '';
    for (const d of [...dates].sort()) {
      dateList.appendChild(el('span', { class: 'date-chip' }, [
        el('span', { text: shortDate(d) }),
        el('button', { class: 'flag-chip-x', text: '×', onclick: () => { dates.delete(d); renderDates(); } }),
      ]));
    }
  }
  renderDates();
  const dateIn = el('input', { class: 'form-input', type: 'date' });
  const addDate = el('button', { class: 'btn-mini', text: 'ADD DATE', onclick: () => { if (dateIn.value) { dates.add(dateIn.value); dateIn.value = ''; renderDates(); } } });
  body.appendChild(el('div', { class: 'date-add-row' }, [dateIn, addDate]));
  body.appendChild(dateList);

  const save = el('button', { class: 'btn btn-primary', style: 'margin-top: 12px;' }, [ el('span', { class: 'btn-title', text: 'SAVE SCHEDULE' }) ]);
  save.addEventListener('click', async () => {
    if (dateIn.value) dates.add(dateIn.value);
    const fresh = await db.get('routines', routine.id);
    if (!fresh) { closeSheet(); return; }
    fresh.scheduleDays = [...days];
    fresh.scheduleDates = [...dates].sort();
    fresh.scheduledDay = null;
    if (fresh.scheduleDays.length && !fresh.scheduleFrom) fresh.scheduleFrom = todayIso();
    fresh.updatedAt = new Date().toISOString();
    await db.put('routines', fresh);
    closeSheet();
    toast(`SCHEDULED · ${scheduleSummary(fresh)}`, 'ok');
    refresh();
  });
  body.appendChild(save);
  openSheet(`ADD "${routine.name}" TO A DAY`, body);
}

// "+" on a day in This Week: put a routine on that one date.
function openAddToDate(iso, routines) {
  const body = el('div', { class: 'action-stack' });
  if (routines.length === 0) body.appendChild(el('div', { class: 'empty-note', text: 'BUILD A ROUTINE FIRST' }));
  for (const r of routines) {
    body.appendChild(el('button', { class: 'nav-row', onclick: async () => {
      const fresh = await db.get('routines', r.id);
      fresh.scheduleDates = [...new Set([...(fresh.scheduleDates || []), iso])].sort();
      fresh.updatedAt = new Date().toISOString();
      await db.put('routines', fresh);
      closeSheet();
      toast(`ADDED · ${r.name} · ${shortDate(iso)}`, 'ok');
      refresh();
    } }, [
      el('div', { class: 'nav-row-main' }, [ el('div', { class: 'nav-row-title', text: r.name }), el('div', { class: 'nav-row-sub', text: scheduleSummary(r) }) ]),
      el('div', { class: 'nav-row-arrow', text: '+' }),
    ]));
  }
  openSheet(`ADD A ROUTINE ON ${shortDate(iso)}`, body);
}

// ---------- Quick workout + log a past workout ----------
async function onQuickWorkout() {
  const active = await getActiveSession();
  if (active) { toast('FINISH OR DISCARD THE ACTIVE WORKOUT FIRST', 'error'); window.location.hash = `#/session/${active.id}`; return; }
  const { startSession } = await import('./workout.js?v=27');
  const s = await startSession({ id: null, name: 'QUICK WORKOUT', scheduledDay: null, exercises: [] });
  window.location.hash = `#/session/${s.id}`;
}

export function openLogPast(routines) {
  const body = el('div', { class: 'form-stack' });
  const yesterday = (() => { const d = parseIso(todayIso()); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  const dateIn = el('input', { class: 'form-input', type: 'date', value: yesterday, max: todayIso() });
  body.appendChild(el('label', { class: 'form-field' }, [ el('span', { class: 'form-label', text: 'DATE OF THE WORKOUT' }), dateIn ]));
  body.appendChild(el('div', { class: 'form-label', text: 'WHICH WORKOUT?' }));
  const choices = [{ id: null, name: 'QUICK WORKOUT (EMPTY)', exercises: [] }, ...routines];
  for (const r of choices) {
    body.appendChild(el('button', { class: 'nav-row', onclick: async () => {
      if (!dateIn.value) { toast('PICK A DATE', 'error'); return; }
      const active = await getActiveSession();
      if (active) { closeSheet(); toast('FINISH OR DISCARD THE ACTIVE WORKOUT FIRST', 'error'); window.location.hash = `#/session/${active.id}`; return; }
      const { startSession } = await import('./workout.js?v=27');
      const s = await startSession(r, { logDate: dateIn.value });
      closeSheet();
      window.location.hash = `#/session/${s.id}`;
    } }, [
      el('div', { class: 'nav-row-main' }, [ el('div', { class: 'nav-row-title', text: r.name }), el('div', { class: 'nav-row-sub', text: `${(r.exercises || []).length} EXERCISES` }) ]),
      el('div', { class: 'nav-row-arrow', text: '›' }),
    ]));
  }
  openSheet('LOG A PAST WORKOUT', body);
}
