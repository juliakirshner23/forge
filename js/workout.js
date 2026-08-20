// FORGE workout execution: log tab, start/active session, session summary
import * as db from './db.js?v=8';
import {
  el, section, notFound, formField, formTextarea,
  catBadge, formatMinSec, formatDate, uid, toast, confirmModal, getActiveSession, currentDayKey, DAY_FULL,
} from './ui.js?v=8';

// ---------- LOG TAB (entry point) ----------
export async function renderLog(container) {
  const [sessions, routines] = await Promise.all([db.getAll('sessions'), db.getAll('routines')]);
  const active = sessions.find((s) => s.isActive === true);
  const completed = sessions.filter((s) => !s.isActive && s.completedAt)
    .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));

  container.appendChild(el('section', { class: 'hero' }, [
    el('div', { class: 'eyebrow', text: `WORKOUT LOG  ·  ${completed.length} COMPLETED` }),
    el('h1', { text: 'LOG' }),
  ]));

  if (active) {
    container.appendChild(section('IN PROGRESS',
      el('a', { class: 'today-card', href: `#/session/${active.id}`, style: 'border-color: var(--green);' }, [
        el('div', { class: 'today-label', style: 'color: var(--green);', text: 'RESUME WORKOUT' }),
        el('div', { class: 'today-name', text: active.routineName || '(session)' }),
        el('div', { class: 'today-meta', text: `STARTED ${new Date(active.startedAt).toLocaleTimeString()}` }),
        el('div', { class: 'today-cta', style: 'color: var(--green);', text: 'RESUME →' }),
      ])
    ));
  } else {
    // Today's routine link (or generic start button)
    const dayKey = currentDayKey();
    const todayRoutine = routines.find((r) => r.scheduledDay === dayKey && r.isActive !== false);
    if (todayRoutine) {
      container.appendChild(section("TODAY'S WORKOUT",
        el('a', { class: 'today-card', href: `#/routine/${todayRoutine.id}` }, [
          el('div', { class: 'today-label', text: DAY_FULL[dayKey] }),
          el('div', { class: 'today-name', text: todayRoutine.name }),
          el('div', { class: 'today-meta', text: `${(todayRoutine.exercises || []).length} EXERCISES  ·  TAP TO START` }),
          el('div', { class: 'today-cta', text: 'GO →' }),
        ])
      ));
    } else {
      container.appendChild(section("TODAY'S WORKOUT",
        el('div', { class: 'today-card today-rest' }, [
          el('div', { class: 'today-label', text: 'REST DAY' }),
          el('div', { class: 'today-sub', text: 'NO ROUTINE SCHEDULED · CHOOSE FROM PLAN TAB IF YOU WANT TO LOG' }),
        ])
      ));
    }
  }

  // Recent sessions
  if (completed.length > 0) {
    const recent = completed.slice(0, 10);
    const list = el('div', {});
    for (const s of recent) list.appendChild(sessionRow(s));
    container.appendChild(section(`RECENT  ·  ${recent.length} OF ${completed.length}`, list));
    if (completed.length > 10) {
      container.appendChild(section('', el('a', { class: 'btn btn-outline', href: '#/history' }, [
        el('span', { class: 'btn-title', text: 'VIEW ALL HISTORY →' }),
        el('span', { class: 'btn-sub', text: 'CALENDAR HEATMAP + FULL LIST' }),
      ])));
    }
  } else {
    container.appendChild(section('RECENT', el('div', { class: 'empty-note', text: 'NO SESSIONS LOGGED YET' })));
  }
}

function sessionRow(s) {
  const setsCount = (s.exercises || []).reduce((n, ex) => n + (ex.sets || []).filter((st) => st.done).length, 0);
  const dur = s.startedAt && s.completedAt ? Math.round((new Date(s.completedAt) - new Date(s.startedAt)) / 60000) : null;
  return el('a', { class: 'nav-row', href: `#/session/${s.id}` }, [
    el('div', { class: 'nav-row-main' }, [
      el('div', { class: 'nav-row-title', text: s.routineName || '(session)' }),
      el('div', { class: 'nav-row-sub', text: `${formatDate(s.completedAt || s.startedAt)}  ·  ${setsCount} SETS${dur != null ? '  ·  ' + dur + ' MIN' : ''}` }),
    ]),
    el('div', { class: 'nav-row-arrow', text: '›' }),
  ]);
}

// ---------- START SESSION (called from routine detail) ----------
export async function startSession(routine) {
  const now = new Date().toISOString();
  const session = {
    id: uid('ses'),
    routineId: routine.id,
    routineName: routine.name,
    routineDay: routine.scheduledDay || null,
    startedAt: now,
    completedAt: null,
    isActive: true,
    currentExerciseIdx: 0,
    exercises: (routine.exercises || []).map((ex, i) => ({
      exerciseId: ex.exerciseId,
      exerciseName: ex.exerciseName,
      order: i,
      restBetweenSets: ex.restBetweenSets || null,
      supersetGroupId: ex.supersetGroupId || null,
      notes: '',
      skipped: false,
      sets: (ex.sets || []).map((s, si) => ({
        order: si,
        type: s.type || 'normal',
        plannedReps: s.reps ?? null,
        plannedWeightLb: s.weightLb ?? null,
        plannedDurationSec: s.durationSec ?? null,
        plannedDistanceMi: s.distanceMi ?? null,
        actualReps: s.reps ?? null,
        actualWeightLb: s.weightLb ?? null,
        actualDurationSec: s.durationSec ?? null,
        actualDistanceMi: s.distanceMi ?? null,
        done: false,
        doneAt: null,
      })),
    })),
    notes: '',
    cardioCalories: null,
    strengthCalories: null,
    prs: [],
  };
  await db.put('sessions', session);
  return session;
}

// ---------- SESSION SCREEN (active workout OR historical view) ----------
export async function renderSession(container, params) {
  const [sessionId, view] = params;
  const session = await db.get('sessions', sessionId);
  if (!session) { container.appendChild(notFound('SESSION NOT FOUND', '#/log', 'LOG')); return; }

  if (view === 'summary' || (!session.isActive && view !== 'edit')) {
    return renderSessionSummary(container, session);
  }
  return renderActiveSession(container, session);
}

// ---------- ACTIVE WORKOUT ----------
let restTimerId = null;
let restEndTime = null;
let elapsedTimerId = null;

async function renderActiveSession(container, session) {
  // Elapsed timer
  const startedAt = new Date(session.startedAt);
  const elapsedEl = el('span', { class: 'session-elapsed', text: '0:00' });
  function updateElapsed() {
    const sec = Math.floor((Date.now() - startedAt.getTime()) / 1000);
    elapsedEl.textContent = formatMinSec(sec);
  }
  updateElapsed();
  clearInterval(elapsedTimerId);
  elapsedTimerId = setInterval(updateElapsed, 1000);

  const totalExercises = (session.exercises || []).length;
  const idx = Math.max(0, Math.min(session.currentExerciseIdx || 0, totalExercises - 1));
  const current = session.exercises[idx];

  // Header
  container.appendChild(el('section', { class: 'hero session-hero' }, [
    el('div', { class: 'eyebrow' }, [
      el('span', { text: `⏱ ` }),
      elapsedEl,
      el('span', { text: `  ·  EXERCISE ${idx + 1} OF ${totalExercises}` }),
    ]),
    el('h1', { text: session.routineName || '(session)' }),
  ]));

  // Exercise nav strip (jumps)
  container.appendChild(section('EXERCISES', exerciseJumpStrip(session, idx)));

  if (!current) {
    container.appendChild(section('', el('div', { class: 'empty-note', text: 'NO EXERCISES' })));
  } else {
    container.appendChild(section('CURRENT', renderExerciseCard(session, current, idx)));
  }

  // Rest timer display
  const restDisplay = el('div', { class: 'rest-display', id: 'rest-display', hidden: true });
  container.appendChild(el('section', { class: 'section', id: 'rest-section' }, [restDisplay]));

  // Bottom actions
  const bottomActions = el('div', { class: 'action-stack' }, [
    el('button', { class: 'btn btn-primary', onclick: () => onFinishClick(session) }, [
      el('span', { class: 'btn-title', text: 'FINISH WORKOUT →' }),
      el('span', { class: 'btn-sub', text: 'REVIEW + SAVE SESSION' }),
    ]),
    el('button', { class: 'btn btn-outline', onclick: () => onAbandonClick(session) }, [
      el('span', { class: 'btn-title', text: 'ABANDON WORKOUT' }),
      el('span', { class: 'btn-sub', text: 'DELETE THIS SESSION WITHOUT SAVING' }),
    ]),
  ]);
  container.appendChild(section('SESSION', bottomActions));
}

function exerciseJumpStrip(session, currentIdx) {
  const strip = el('div', { class: 'jump-strip' });
  (session.exercises || []).forEach((ex, i) => {
    const doneSets = (ex.sets || []).filter((s) => s.done).length;
    const totalSets = (ex.sets || []).length;
    const isCurrent = i === currentIdx;
    const isDone = doneSets === totalSets && totalSets > 0;
    const cls = 'jump-chip' + (isCurrent ? ' jump-chip-current' : '') + (isDone ? ' jump-chip-done' : '') + (ex.skipped ? ' jump-chip-skipped' : '');
    const chip = el('button', { class: cls, text: `${i + 1}` });
    chip.addEventListener('click', async () => {
      session.currentExerciseIdx = i;
      await db.put('sessions', session);
      refresh();
    });
    strip.appendChild(chip);
  });
  return strip;
}

function renderExerciseCard(session, current, idx) {
  const wrap = el('div', { class: 'active-exercise' });
  wrap.appendChild(el('div', { class: 'active-name', text: current.exerciseName || '(unknown)' }));

  // Sets grid
  const grid = el('div', { class: 'set-grid' });
  (current.sets || []).forEach((set, si) => {
    grid.appendChild(setCell(session, current, idx, set, si));
  });
  wrap.appendChild(grid);

  // Add set / remove set
  const setActions = el('div', { class: 'set-actions' }, [
    el('button', { class: 'set-btn', text: '+ ADD SET', onclick: () => onAddSet(session, current, idx) }),
    el('button', { class: 'set-btn set-btn-danger', text: '− REMOVE LAST SET', onclick: () => onRemoveSet(session, current, idx) }),
  ]);
  wrap.appendChild(setActions);

  // Nav
  const nav = el('div', { class: 'exercise-nav' }, [
    el('button', { class: 'nav-btn', text: '‹ PREV', onclick: () => onNav(session, idx - 1) }),
    el('button', { class: 'nav-btn nav-btn-skip', text: current.skipped ? 'UNSKIP' : 'SKIP', onclick: () => onSkip(session, current, idx) }),
    el('button', { class: 'nav-btn', text: 'NEXT ›', onclick: () => onNav(session, idx + 1) }),
  ]);
  wrap.appendChild(nav);

  return wrap;
}

function setCell(session, current, exIdx, set, setIdx) {
  const done = set.done;
  const isDuration = set.plannedDurationSec != null || set.actualDurationSec != null;
  const label = isDuration
    ? (set.actualDurationSec != null ? `${Math.round(set.actualDurationSec / 60)}m` : `${Math.round((set.plannedDurationSec || 0) / 60)}m plan`)
    : (set.actualReps != null && set.actualWeightLb != null)
      ? `${set.actualReps} × ${set.actualWeightLb}lb`
      : set.actualReps != null
        ? `${set.actualReps} reps`
        : set.plannedReps != null
          ? `${set.plannedReps} × ${set.plannedWeightLb ?? '—'}lb plan`
          : 'set';

  const cell = el('button', { class: 'set-cell' + (done ? ' set-cell-done' : '') }, [
    el('div', { class: 'set-cell-num', text: `SET ${setIdx + 1}` }),
    el('div', { class: 'set-cell-val', text: label }),
    el('div', { class: 'set-cell-mark', text: done ? '✓' : '○' }),
  ]);
  cell.addEventListener('click', () => openSetEntry(session, current, exIdx, set, setIdx));
  return cell;
}

function openSetEntry(session, current, exIdx, set, setIdx) {
  const isDuration = set.plannedDurationSec != null;
  document.getElementById('inspector-title').textContent = `SET ${setIdx + 1} · ${current.exerciseName}`;
  const body = document.getElementById('inspector-body');
  body.innerHTML = '';

  const form = el('div', { class: 'form-stack' });
  if (isDuration) {
    form.appendChild(formField('DURATION (SECONDS)', 'number', 'duration', set.actualDurationSec ?? set.plannedDurationSec ?? '', 'e.g. 1500'));
    form.appendChild(formField('DISTANCE (MI, OPTIONAL)', 'number', 'distance', set.actualDistanceMi ?? '', 'e.g. 2.1', { step: '0.01' }));
  } else {
    form.appendChild(formField('REPS', 'number', 'reps', set.actualReps ?? set.plannedReps ?? '', 'e.g. 10'));
    form.appendChild(formField('WEIGHT (LB)', 'number', 'weight', set.actualWeightLb ?? set.plannedWeightLb ?? '', 'e.g. 20', { step: '0.5' }));
  }

  const logBtn = el('button', { class: 'btn btn-primary', style: 'margin-top: 12px;' }, [
    el('span', { class: 'btn-title', text: 'LOG SET' }),
    el('span', { class: 'btn-sub', text: 'START REST TIMER' }),
  ]);
  logBtn.addEventListener('click', async () => {
    if (isDuration) {
      const d = form.querySelector('[name="duration"]').value;
      const dist = form.querySelector('[name="distance"]').value;
      set.actualDurationSec = d ? Number(d) : null;
      set.actualDistanceMi = dist ? Number(dist) : null;
    } else {
      const r = form.querySelector('[name="reps"]').value;
      const w = form.querySelector('[name="weight"]').value;
      set.actualReps = r ? Number(r) : null;
      set.actualWeightLb = w ? Number(w) : null;
    }
    set.done = true;
    set.doneAt = new Date().toISOString();
    await db.put('sessions', session);
    document.getElementById('inspector-scrim').hidden = true;
    startRestTimer(current.restBetweenSets || 60);
    // If all sets done, auto-advance
    const allDone = (current.sets || []).every((s) => s.done);
    if (allDone && exIdx < (session.exercises || []).length - 1) {
      setTimeout(() => onNav(session, exIdx + 1), 300);
    } else {
      refresh();
    }
  });

  const clearBtn = el('button', { class: 'btn btn-outline', style: 'margin-top: 8px;' }, [
    el('span', { class: 'btn-title', text: 'MARK NOT DONE' }),
    el('span', { class: 'btn-sub', text: 'CLEAR THIS SET' }),
  ]);
  clearBtn.addEventListener('click', async () => {
    set.done = false;
    set.doneAt = null;
    await db.put('sessions', session);
    document.getElementById('inspector-scrim').hidden = true;
    refresh();
  });

  body.appendChild(form);
  body.appendChild(logBtn);
  body.appendChild(clearBtn);
  document.getElementById('inspector-scrim').hidden = false;
}

function startRestTimer(seconds) {
  const display = document.getElementById('rest-display');
  if (!display) return;
  display.hidden = false;
  restEndTime = Date.now() + seconds * 1000;
  clearInterval(restTimerId);

  function tick() {
    const remaining = Math.max(0, Math.floor((restEndTime - Date.now()) / 1000));
    display.innerHTML = '';
    display.appendChild(el('div', { class: 'rest-label', text: 'REST TIMER' }));
    display.appendChild(el('div', { class: 'rest-time', text: formatMinSec(remaining) }));
    display.appendChild(el('button', { class: 'set-btn', text: 'SKIP REST', onclick: () => { clearInterval(restTimerId); display.hidden = true; } }));
    if (remaining <= 0) {
      clearInterval(restTimerId);
      display.classList.add('rest-done');
      display.appendChild(el('div', { class: 'rest-done-note', text: '✓ REST COMPLETE' }));
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      setTimeout(() => { display.hidden = true; display.classList.remove('rest-done'); }, 3000);
    }
  }
  tick();
  restTimerId = setInterval(tick, 250);
}

async function onAddSet(session, current, exIdx) {
  const lastSet = (current.sets || [])[current.sets.length - 1];
  current.sets.push({
    order: current.sets.length,
    type: 'normal',
    plannedReps: lastSet?.plannedReps ?? null,
    plannedWeightLb: lastSet?.plannedWeightLb ?? null,
    plannedDurationSec: lastSet?.plannedDurationSec ?? null,
    plannedDistanceMi: lastSet?.plannedDistanceMi ?? null,
    actualReps: null, actualWeightLb: null, actualDurationSec: null, actualDistanceMi: null,
    done: false, doneAt: null,
  });
  await db.put('sessions', session);
  refresh();
}
async function onRemoveSet(session, current, exIdx) {
  if ((current.sets || []).length === 0) return;
  current.sets.pop();
  await db.put('sessions', session);
  refresh();
}
async function onNav(session, newIdx) {
  const max = (session.exercises || []).length - 1;
  session.currentExerciseIdx = Math.max(0, Math.min(newIdx, max));
  await db.put('sessions', session);
  refresh();
}
async function onSkip(session, current, exIdx) {
  current.skipped = !current.skipped;
  await db.put('sessions', session);
  refresh();
}
function onAbandonClick(session) {
  confirmModal('ABANDON WORKOUT?', 'Delete this session without saving. Sets logged so far will be lost. Continue?', async () => {
    clearInterval(elapsedTimerId); clearInterval(restTimerId);
    await db.remove('sessions', session.id);
    toast('SESSION ABANDONED', 'ok');
    window.location.hash = '#/home';
  });
}
async function onFinishClick(session) {
  clearInterval(elapsedTimerId); clearInterval(restTimerId);
  window.location.hash = `#/session/${session.id}/summary`;
}
async function refresh() { const m = await import('./app.js?v=8'); m.refresh && m.refresh(); }

// ---------- SESSION SUMMARY ----------
async function renderSessionSummary(container, session) {
  const isFinishing = session.isActive === true;
  const startedAt = new Date(session.startedAt);
  const completedAt = session.completedAt ? new Date(session.completedAt) : new Date();
  const durationMin = Math.round((completedAt - startedAt) / 60000);
  const totalSets = (session.exercises || []).reduce((n, ex) => n + (ex.sets || []).filter((s) => s.done).length, 0);
  const totalExercises = (session.exercises || []).filter((ex) => (ex.sets || []).some((s) => s.done)).length;
  const skipped = (session.exercises || []).filter((ex) => ex.skipped).length;

  // For finishing, snapshot PRs by comparing to prior best per exercise
  let prs = session.prs || [];
  if (isFinishing) {
    prs = await computePRs(session);
  }

  container.appendChild(el('section', { class: 'hero' }, [
    el('div', { class: 'eyebrow' }, [
      el('a', { href: isFinishing ? `#/session/${session.id}` : '#/history', class: 'crumb', text: isFinishing ? '‹ BACK TO SESSION' : '‹ HISTORY' }),
      el('span', { text: '  ·  ' + (isFinishing ? 'REVIEW' : 'SESSION') }),
    ]),
    el('h1', { text: session.routineName || '(session)' }),
    el('p', { class: 'hero-meta', text: `${formatDate(session.startedAt)}  ·  ${durationMin} MIN  ·  ${totalSets} SETS  ·  ${totalExercises} EXERCISES` }),
  ]));

  // Stats strip
  container.appendChild(section('SUMMARY', el('div', { class: 'stat-strip' }, [
    el('div', { class: 'stat-mini' }, [
      el('span', { class: 'stat-mini-label', text: 'DURATION' }),
      el('span', { class: 'stat-mini-value', text: durationMin }),
      el('span', { class: 'stat-mini-sub', text: 'MIN' }),
    ]),
    el('div', { class: 'stat-mini' }, [
      el('span', { class: 'stat-mini-label', text: 'SETS' }),
      el('span', { class: 'stat-mini-value', text: totalSets }),
      el('span', { class: 'stat-mini-sub', text: 'LOGGED' }),
    ]),
    el('div', { class: 'stat-mini' }, [
      el('span', { class: 'stat-mini-label', text: 'PRs' }),
      el('span', { class: 'stat-mini-value', text: prs.length }),
      el('span', { class: 'stat-mini-sub', text: 'THIS SESSION' }),
    ]),
  ])));

  // PRs list
  if (prs.length > 0) {
    const prList = el('div', { class: 'exercise-list' });
    for (const pr of prs) {
      prList.appendChild(el('div', { class: 'exercise-row' }, [
        el('div', { class: 'exercise-num', text: '★' }),
        el('div', { class: 'exercise-main' }, [
          el('div', { class: 'exercise-name', text: pr.exerciseName }),
          el('div', { class: 'exercise-meta', text: `${pr.type.toUpperCase()} · ${pr.value}${pr.previousValue != null ? ' (WAS ' + pr.previousValue + ')' : ' (NEW)'}` }),
        ]),
      ]));
    }
    container.appendChild(section(`PERSONAL BESTS  ·  ${prs.length}`, prList));
  }

  // Exercises done
  const exList = el('div', { class: 'exercise-list' });
  for (const ex of (session.exercises || [])) {
    const doneSets = (ex.sets || []).filter((s) => s.done);
    if (doneSets.length === 0 && !ex.skipped) continue;
    const meta = ex.skipped ? 'SKIPPED' : doneSetsSummary(doneSets);
    exList.appendChild(el('div', { class: 'exercise-row' }, [
      el('div', { class: 'exercise-num', text: doneSets.length || '·' }),
      el('div', { class: 'exercise-main' }, [
        el('div', { class: 'exercise-name', text: ex.exerciseName }),
        el('div', { class: 'exercise-meta', text: meta }),
      ]),
    ]));
  }
  container.appendChild(section('EXERCISES DONE', exList));

  // Manual calorie entry + notes (only when finishing)
  if (isFinishing) {
    const form = el('div', { class: 'form-stack' });
    form.appendChild(formField('CARDIO CALORIES (OPTIONAL)', 'number', 'cardioCalories', session.cardioCalories ?? '', 'FROM MACHINE OR ESTIMATE'));
    form.appendChild(formField('STRENGTH CALORIES (OPTIONAL)', 'number', 'strengthCalories', session.strengthCalories ?? '', 'FROM MACHINE OR ESTIMATE'));
    form.appendChild(formTextarea('SESSION NOTES', 'notes', session.notes, 'How did the workout feel? Anything to remember?'));
    container.appendChild(section('LOG DETAILS', form));

    const saveBtn = el('button', { class: 'btn btn-primary' }, [
      el('span', { class: 'btn-title', text: 'SAVE SESSION' }),
      el('span', { class: 'btn-sub', text: 'MARK AS COMPLETE + ADD TO HISTORY' }),
    ]);
    saveBtn.addEventListener('click', async () => {
      session.cardioCalories = form.querySelector('[name="cardioCalories"]').value ? Number(form.querySelector('[name="cardioCalories"]').value) : null;
      session.strengthCalories = form.querySelector('[name="strengthCalories"]').value ? Number(form.querySelector('[name="strengthCalories"]').value) : null;
      session.notes = form.querySelector('[name="notes"]').value.trim();
      session.completedAt = completedAt.toISOString();
      session.isActive = false;
      session.prs = prs;
      await db.put('sessions', session);
      toast(`SESSION SAVED  ·  ${totalSets} SETS`, 'ok', 3500);
      window.location.hash = '#/home';
    });
    container.appendChild(section('FINISH', el('div', { class: 'action-stack' }, [saveBtn])));
  } else {
    // Historical session: show notes/calories read-only + delete button
    if (session.notes) container.appendChild(section('NOTES', el('div', { class: 'note-block', text: session.notes })));
    const infoCard = el('div', { class: 'settings-list' });
    if (session.cardioCalories != null) infoCard.appendChild(el('div', { class: 'settings-row' }, [
      el('span', { class: 'settings-key', text: 'CARDIO CALORIES' }),
      el('span', { class: 'settings-value', text: String(session.cardioCalories) }),
    ]));
    if (session.strengthCalories != null) infoCard.appendChild(el('div', { class: 'settings-row' }, [
      el('span', { class: 'settings-key', text: 'STRENGTH CALORIES' }),
      el('span', { class: 'settings-value', text: String(session.strengthCalories) }),
    ]));
    if (infoCard.children.length > 0) container.appendChild(section('DETAILS', infoCard));

    container.appendChild(section('ACTIONS', el('div', { class: 'action-stack' }, [
      el('button', { class: 'btn btn-danger', onclick: () => {
        confirmModal('DELETE SESSION?', 'This permanently removes this session. Cannot be undone.', async () => {
          await db.remove('sessions', session.id);
          toast('SESSION DELETED', 'ok');
          window.location.hash = '#/history';
        });
      } }, [
        el('span', { class: 'btn-title', text: 'DELETE SESSION' }),
        el('span', { class: 'btn-sub', text: 'IRREVERSIBLE' }),
      ]),
    ])));
  }
}

function doneSetsSummary(sets) {
  if (sets.length === 0) return 'NONE';
  const first = sets[0];
  if (first.actualDurationSec != null) return sets.map((s) => `${Math.round(s.actualDurationSec / 60)}M`).join(' · ');
  return sets.map((s) => `${s.actualReps ?? '?'}${s.actualWeightLb != null ? '×' + s.actualWeightLb : ''}`).join(' · ');
}

async function computePRs(session) {
  const allSessions = await db.getAll('sessions');
  const past = allSessions.filter((s) => s.id !== session.id && !s.isActive && s.completedAt);
  const prs = [];
  for (const ex of (session.exercises || [])) {
    const doneSets = (ex.sets || []).filter((s) => s.done);
    if (doneSets.length === 0) continue;

    // Strength PR: max weight × reps
    const currentMaxWeight = Math.max(...doneSets.map((s) => s.actualWeightLb || 0));
    const currentMaxReps = Math.max(...doneSets.map((s) => s.actualReps || 0));
    const currentMaxDuration = Math.max(...doneSets.map((s) => s.actualDurationSec || 0));

    // Historical best for same exerciseId
    let prevBestWeight = 0, prevBestReps = 0, prevBestDuration = 0;
    for (const s of past) {
      for (const pex of (s.exercises || [])) {
        if (pex.exerciseId !== ex.exerciseId) continue;
        for (const set of (pex.sets || [])) {
          if (!set.done) continue;
          prevBestWeight = Math.max(prevBestWeight, set.actualWeightLb || 0);
          prevBestReps = Math.max(prevBestReps, set.actualReps || 0);
          prevBestDuration = Math.max(prevBestDuration, set.actualDurationSec || 0);
        }
      }
    }

    if (currentMaxWeight > prevBestWeight && currentMaxWeight > 0) {
      prs.push({ exerciseId: ex.exerciseId, exerciseName: ex.exerciseName, type: 'weight', value: currentMaxWeight, previousValue: prevBestWeight || null });
    }
    if (currentMaxReps > prevBestReps && currentMaxReps > 0 && currentMaxWeight === 0) {
      // Only rep PR if bodyweight-ish (no weight increase to compete)
      prs.push({ exerciseId: ex.exerciseId, exerciseName: ex.exerciseName, type: 'reps', value: currentMaxReps, previousValue: prevBestReps || null });
    }
    if (currentMaxDuration > prevBestDuration && currentMaxDuration > 0) {
      prs.push({ exerciseId: ex.exerciseId, exerciseName: ex.exerciseName, type: 'duration', value: `${Math.round(currentMaxDuration / 60)}m`, previousValue: prevBestDuration ? Math.round(prevBestDuration / 60) + 'm' : null });
    }
  }
  return prs;
}
