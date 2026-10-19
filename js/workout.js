// FORGE workout execution: log tab, start/active session, session summary
import * as db from './db.js?v=23';
import {
  el, section, notFound, formField, formTextarea, formSelect, openPicker,
  catBadge, formatMinSec, formatDate, uid, toast, confirmModal, askModal, getActiveSession, currentDayKey, DAY_FULL,
} from './ui.js?v=23';
import { est1RM, exerciseSuggestion } from './progression.js?v=23';

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
      pickOneGroupId: ex.pickOneGroupId || null,
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

  if (!session.isActive) return renderSessionSummary(container, session);
  return renderActiveSession(container, session);
}

// ---------- ACTIVE WORKOUT ----------
let restTimerId = null;
let restEndTime = null;
let elapsedTimerId = null;

export function suggestionNote(sg) {
  return el('div', { class: `ex-suggest ex-suggest-${sg.kind}` }, [
    el('span', { class: 'ex-suggest-kind', text: sg.label }),
    el('span', { class: 'ex-suggest-text', text: sg.text }),
  ]);
}

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
      el('button', { class: 'session-menu-btn', text: '☰', onclick: () => openSessionMenu(session) }),
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
    el('button', { class: 'btn btn-outline', onclick: () => addExerciseMidSession(session) }, [
      el('span', { class: 'btn-title', text: '+ ADD EXERCISE' }),
      el('span', { class: 'btn-sub', text: 'INSERT ONE MORE INTO THIS SESSION' }),
    ]),
    el('button', { class: 'btn btn-primary', onclick: () => openFinishModal(session) }, [
      el('span', { class: 'btn-title', text: 'FINISH & SAVE WORKOUT' }),
      el('span', { class: 'btn-sub', text: 'ADDS IT TO YOUR LOG' }),
    ]),
    el('button', { class: 'btn btn-outline', onclick: () => onAbandonClick(session) }, [
      el('span', { class: 'btn-title', text: 'DISCARD WORKOUT' }),
      el('span', { class: 'btn-sub', text: 'DELETE WITHOUT SAVING' }),
    ]),
  ]);
  container.appendChild(section('SESSION', bottomActions));
}

// Hamburger menu for the active session.
async function openSessionMenu(session) {
  document.getElementById('inspector-title').textContent = 'SESSION MENU';
  const body = document.getElementById('inspector-body');
  body.innerHTML = '';
  const stack = el('div', { class: 'action-stack' }, [
    el('a', { class: 'btn btn-outline', href: '#/home', onclick: () => { document.getElementById('inspector-scrim').hidden = true; } }, [
      el('span', { class: 'btn-title', text: 'PAUSE · GO HOME' }),
      el('span', { class: 'btn-sub', text: 'SESSION STAYS ACTIVE, RESUME LATER' }),
    ]),
    el('button', { class: 'btn btn-outline', onclick: () => { document.getElementById('inspector-scrim').hidden = true; addExerciseMidSession(session); } }, [
      el('span', { class: 'btn-title', text: '+ ADD EXERCISE' }),
      el('span', { class: 'btn-sub', text: 'INSERT INTO CURRENT SESSION' }),
    ]),
    el('a', { class: 'btn btn-outline', href: `#/routine/${session.routineId}`, onclick: () => { document.getElementById('inspector-scrim').hidden = true; } }, [
      el('span', { class: 'btn-title', text: "EDIT TODAY'S ROUTINE" }),
      el('span', { class: 'btn-sub', text: 'CHANGES APPLY TO THE ROUTINE' }),
    ]),
    el('button', { class: 'btn btn-danger', onclick: () => { document.getElementById('inspector-scrim').hidden = true; onAbandonClick(session); } }, [
      el('span', { class: 'btn-title', text: 'DISCARD WORKOUT' }),
      el('span', { class: 'btn-sub', text: 'DELETE WITHOUT SAVING' }),
    ]),
  ]);
  body.appendChild(stack);
  document.getElementById('inspector-scrim').hidden = false;
}

async function addExerciseMidSession(session) {
  const settings = await db.getSetting('constraints');
  const activeFlags = settings?.active ? (settings.flags || []) : [];
  const { openExercisePicker } = await import('./exercise-picker.js?v=23');
  openExercisePicker('ADD EXERCISE TO WORKOUT', async (ex) => {
    const flagged = (ex.constraintFlags || []).some((f) => activeFlags.includes(f));
    if (flagged) {
      const ok = await askModal('CONSTRAINT WARNING', `${ex.name} conflicts with your active constraints. Add anyway?`, 'ADD ANYWAY', 'CANCEL');
      if (!ok) return;
    }
    const isCardio = ex.category === 'cardio';
    session.exercises = [...(session.exercises || []), {
      exerciseId: ex.id,
      exerciseName: ex.name,
      order: (session.exercises || []).length,
      restBetweenSets: 60,
      supersetGroupId: null,
      notes: '',
      skipped: false,
      sets: isCardio
        ? [{ order: 0, type: 'normal', plannedDurationSec: 1500, actualDurationSec: null, done: false }]
        : [{ order: 0, type: 'normal', plannedReps: 10, plannedWeightLb: null, actualReps: null, actualWeightLb: null, done: false }],
    }];
    session.currentExerciseIdx = session.exercises.length - 1;
    await db.put('sessions', session);
    toast(`ADDED · ${ex.name}`, 'ok');

    // Offer to keep it in the routine for next time.
    const routine = session.routineId ? await db.get('routines', session.routineId) : null;
    if (routine && !(routine.exercises || []).some((e) => e.exerciseId === ex.id)) {
      const keep = await askModal('SAVE TO ROUTINE?',
        `Also add ${ex.name} to "${routine.name}" permanently?`, 'SAVE TO ROUTINE', 'THIS WORKOUT ONLY');
      if (keep) {
        const { routineEntryFor } = await import('./routine-editor.js?v=23');
        routine.exercises = [...(routine.exercises || []), routineEntryFor(ex, (routine.exercises || []).length)];
        routine.updatedAt = new Date().toISOString();
        await db.put('routines', routine);
        toast(`SAVED TO ${routine.name}`, 'ok');
      }
    }
    refresh();
  }, { activeFlags });
}

function exerciseJumpStrip(session, currentIdx) {
  const strip = el('div', { class: 'jump-strip' });
  const currentGroupId = (session.exercises || [])[currentIdx]?.pickOneGroupId;
  (session.exercises || []).forEach((ex, i) => {
    const doneSets = (ex.sets || []).filter((s) => s.done).length;
    const totalSets = (ex.sets || []).length;
    const isCurrent = i === currentIdx;
    const isDone = doneSets === totalSets && totalSets > 0;
    const isGroupMate = currentGroupId && ex.pickOneGroupId === currentGroupId;
    const cls = 'jump-chip'
      + (isCurrent ? ' jump-chip-current' : '')
      + (isDone ? ' jump-chip-done' : '')
      + (ex.skipped ? ' jump-chip-skipped' : '')
      + (isGroupMate && !isCurrent ? ' jump-chip-groupmate' : '');
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

  // Pick-one group indicator: names all sibling exercises in the group,
  // with jump chips. Non-exclusive — you can log any or all of them.
  if (current.pickOneGroupId) {
    const siblings = (session.exercises || [])
      .map((ex, i) => ({ ex, i }))
      .filter(({ ex, i }) => ex.pickOneGroupId === current.pickOneGroupId && i !== idx);
    if (siblings.length > 0) {
      const groupBanner = el('div', { class: 'group-banner' }, [
        el('div', { class: 'group-banner-label', text: `◇ ALTERNATIVES · GROUP ${current.pickOneGroupId.toUpperCase()}` }),
        el('div', { class: 'group-banner-sub', text: 'LOG ANY OR ALL OF THESE. NOT MUTUALLY EXCLUSIVE.' }),
        el('div', { class: 'group-banner-chips' },
          siblings.map(({ ex, i }) => {
            const doneCount = (ex.sets || []).filter((s) => s.done).length;
            const chip = el('button', {
              class: 'group-chip' + (doneCount > 0 ? ' group-chip-logged' : ''),
              text: `${ex.exerciseName}${doneCount ? ` · ${doneCount}` : ''}`,
              onclick: async () => { session.currentExerciseIdx = i; await db.put('sessions', session); refresh(); },
            });
            return chip;
          })
        ),
      ]);
      wrap.appendChild(groupBanner);
    }
  }

  wrap.appendChild(el('div', { class: 'active-name', text: current.exerciseName || '(unknown)' }));
  const tip = el('div', {});
  wrap.appendChild(tip);
  exerciseSuggestion(current.exerciseId).then((sg) => { if (sg) tip.replaceWith(suggestionNote(sg)); });

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
  let label;
  if (isDuration && set.actualDurationSec != null) {
    // Logged cardio: show minutes plus any speed/incline/level info
    const parts = [`${Math.round(set.actualDurationSec / 60)}m`];
    if (set.actualSpeedMph != null)   parts.push(`${set.actualSpeedMph}mph`);
    if (set.actualInclinePct != null) parts.push(`${set.actualInclinePct}%`);
    if (set.actualResistance != null) parts.push(`R${set.actualResistance}`);
    if (set.actualDistanceMi != null) parts.push(`${set.actualDistanceMi}mi`);
    if (set.actualStepsClimbed != null) parts.push(`${set.actualStepsClimbed} steps`);
    label = parts.join(' · ');
  } else if (isDuration) {
    label = `${Math.round((set.plannedDurationSec || 0) / 60)}m plan`;
  } else if (set.type === 'single_side' && (set.actualRepsL != null || set.actualRepsR != null)) {
    const rL = set.actualRepsL ?? '—', rR = set.actualRepsR ?? '—';
    const wL = set.actualWeightLbL ?? '', wR = set.actualWeightLbR ?? '';
    label = `L ${rL}${wL ? `×${wL}` : ''} · R ${rR}${wR ? `×${wR}` : ''}`;
  } else if (set.actualReps != null && set.actualWeightLb != null) {
    label = `${set.actualReps} × ${set.actualWeightLb}lb`;
  } else if (set.actualReps != null) {
    label = `${set.actualReps} reps`;
  } else if (set.plannedReps != null) {
    label = `${set.plannedReps} × ${set.plannedWeightLb ?? '—'}lb plan`;
  } else {
    label = 'set';
  }

  const cell = el('button', { class: 'set-cell' + (done ? ' set-cell-done' : '') }, [
    el('div', { class: 'set-cell-num', text: `SET ${setIdx + 1}` }),
    el('div', { class: 'set-cell-val', text: label }),
    el('div', { class: 'set-cell-mark', text: done ? '✓' : '○' }),
  ]);
  cell.addEventListener('click', () => openSetEntry(session, current, exIdx, set, setIdx));
  return cell;
}

// Machines with dynamic intensity fields. Order matters — first two are
// what determine whether we can auto-calc distance from speed × time.
const CARDIO_MACHINES = {
  elliptical: {
    label: 'ELLIPTICAL',
    fields: [
      { key: 'resistance', label: 'RESISTANCE',      placeholder: 'e.g. 8',   step: '1' },
      { key: 'speedMph',   label: 'AVG SPEED (MPH)', placeholder: 'e.g. 3.5', step: '0.1' },
    ],
    distanceFromSpeed: true,
  },
  treadmill: {
    label: 'TREADMILL',
    fields: [
      { key: 'speedMph',   label: 'SPEED (MPH)',     placeholder: 'e.g. 3.0', step: '0.1' },
      { key: 'inclinePct', label: 'INCLINE (%)',     placeholder: 'e.g. 8',   step: '0.5' },
    ],
    distanceFromSpeed: true,
  },
  stairmaster: {
    label: 'STAIRMASTER',
    fields: [
      { key: 'speedMph',     label: 'LEVEL (SPEED)',  placeholder: 'e.g. 6',   step: '1' },
      { key: 'stepsClimbed', label: 'STEPS CLIMBED',  placeholder: 'e.g. 800', step: '1' },
    ],
    distanceFromSpeed: false,
  },
  outdoor_run: {
    label: 'OUTDOOR RUN',
    fields: [
      { key: 'speedMph', label: 'AVG SPEED (MPH)', placeholder: 'e.g. 5.5', step: '0.1' },
    ],
    distanceFromSpeed: true,
  },
  bike: {
    label: 'BIKE',
    fields: [
      { key: 'resistance', label: 'RESISTANCE',      placeholder: 'e.g. 8',   step: '1' },
      { key: 'speedMph',   label: 'AVG SPEED (MPH)', placeholder: 'e.g. 12',  step: '0.1' },
    ],
    distanceFromSpeed: true,
  },
  rower: {
    label: 'ROWER',
    fields: [
      { key: 'speedMph', label: 'AVG SPEED (MPH)', placeholder: 'e.g. 6', step: '0.1' },
    ],
    distanceFromSpeed: true,
  },
  other: { label: 'OTHER', fields: [], distanceFromSpeed: false },
};

function machineOptions() {
  return Object.entries(CARDIO_MACHINES).map(([value, m]) => ({ value, label: m.label }));
}

async function openSetEntry(session, current, exIdx, set, setIdx) {
  document.getElementById('inspector-title').textContent = `SET ${setIdx + 1} · ${current.exerciseName}`;
  const body = document.getElementById('inspector-body');
  body.innerHTML = '';

  // Look up the library exercise to know if it's cardio and which machine.
  const libEx = await db.get('exercises', current.exerciseId);
  const isCardio = libEx?.category === 'cardio';
  const isDuration = set.plannedDurationSec != null || isCardio;

  const form = el('div', { class: 'form-stack' });

  if (isCardio) {
    // Machine dropdown (default = actual override > library default > 'other')
    const defaultMachine = set.actualMachine || libEx?.cardioMachine || 'other';
    const machineSelect = document.createElement('select');
    machineSelect.className = 'form-input form-select';
    machineSelect.name = 'machine';
    for (const opt of machineOptions()) {
      const o = document.createElement('option');
      o.value = opt.value; o.textContent = opt.label;
      if (opt.value === defaultMachine) o.selected = true;
      machineSelect.appendChild(o);
    }
    form.appendChild(el('label', { class: 'form-field' }, [
      el('span', { class: 'form-label', text: 'MACHINE' }),
      machineSelect,
    ]));

    // Dynamic intensity fields container — re-rendered when machine changes.
    const intensityWrap = el('div', { class: 'form-stack' });
    form.appendChild(intensityWrap);

    function renderIntensity() {
      intensityWrap.innerHTML = '';
      const conf = CARDIO_MACHINES[machineSelect.value] || CARDIO_MACHINES.other;
      for (const f of conf.fields) {
        const currentVal = set[`actual${cap(f.key)}`] ?? '';
        intensityWrap.appendChild(formField(f.label, 'number', f.key, currentVal, f.placeholder, { step: f.step }));
      }
    }
    machineSelect.addEventListener('change', renderIntensity);
    renderIntensity();

    // Duration + Distance always present for cardio.
    const plannedMin = set.actualDurationSec != null ? (set.actualDurationSec / 60)
      : (set.plannedDurationSec != null ? (set.plannedDurationSec / 60) : '');
    form.appendChild(formField('DURATION (MINUTES)', 'number', 'duration', plannedMin, 'e.g. 25', { step: '0.1' }));
    form.appendChild(formField('DISTANCE (MI)', 'number', 'distance', set.actualDistanceMi ?? '', 'LEAVE BLANK TO AUTO-CALC FROM SPEED × TIME', { step: '0.01' }));
  } else if (isDuration) {
    const plannedMin = set.actualDurationSec != null ? (set.actualDurationSec / 60)
      : (set.plannedDurationSec != null ? (set.plannedDurationSec / 60) : '');
    form.appendChild(formField('DURATION (MINUTES)', 'number', 'duration', plannedMin, 'e.g. 25', { step: '0.1' }));
    form.appendChild(formSelect('SET TYPE', 'setType', set.type || 'normal', SET_TYPES));
    form.appendChild(formField('NOTES', 'text', 'setNotes', set.notes || '', 'RPE, form cue, anything'));
  } else {
    // Set type dropdown drives whether we show single or L/R inputs.
    const initialType = set.type || 'normal';
    form.appendChild(formSelect('SET TYPE', 'setType', initialType, SET_TYPES));
    const dynWrap = el('div', { class: 'form-stack' });
    form.appendChild(dynWrap);
    form.appendChild(formField('NOTES', 'text', 'setNotes', set.notes || '', 'RPE, form cue, anything'));
    const oneRmHint = el('div', { class: 'form-hint', text: '' });
    form.appendChild(oneRmHint);

    function renderFields() {
      dynWrap.innerHTML = '';
      const t = form.querySelector('[name="setType"]').value;
      if (t === 'single_side') {
        dynWrap.appendChild(formField('LEFT · REPS', 'number', 'repsL', set.actualRepsL ?? set.actualReps ?? set.plannedReps ?? '', 'e.g. 10'));
        dynWrap.appendChild(formField('LEFT · WEIGHT (LB)', 'number', 'weightL', set.actualWeightLbL ?? set.actualWeightLb ?? set.plannedWeightLb ?? '', 'e.g. 20', { step: '0.5' }));
        dynWrap.appendChild(formField('RIGHT · REPS', 'number', 'repsR', set.actualRepsR ?? set.actualReps ?? set.plannedReps ?? '', 'e.g. 10'));
        dynWrap.appendChild(formField('RIGHT · WEIGHT (LB)', 'number', 'weightR', set.actualWeightLbR ?? set.actualWeightLb ?? set.plannedWeightLb ?? '', 'e.g. 20', { step: '0.5' }));
      } else {
        dynWrap.appendChild(formField('REPS', 'number', 'reps', set.actualReps ?? set.plannedReps ?? '', 'e.g. 10'));
        dynWrap.appendChild(formField('WEIGHT (LB)', 'number', 'weight', set.actualWeightLb ?? set.plannedWeightLb ?? '', 'e.g. 20', { step: '0.5' }));
      }
      wireUpHintUpdaters();
    }
    function wireUpHintUpdaters() {
      const t = form.querySelector('[name="setType"]').value;
      function updateHint() {
        let r, w;
        if (t === 'single_side') {
          const rL = Number(dynWrap.querySelector('[name="repsL"]')?.value) || 0;
          const rR = Number(dynWrap.querySelector('[name="repsR"]')?.value) || 0;
          const wL = Number(dynWrap.querySelector('[name="weightL"]')?.value) || 0;
          const wR = Number(dynWrap.querySelector('[name="weightR"]')?.value) || 0;
          r = Math.max(rL, rR); w = Math.max(wL, wR);
        } else {
          r = Number(dynWrap.querySelector('[name="reps"]')?.value);
          w = Number(dynWrap.querySelector('[name="weight"]')?.value);
        }
        const est = est1RM(w, r);
        oneRmHint.textContent = est ? `EST 1RM · ${est} LB` : '';
      }
      dynWrap.querySelectorAll('input').forEach((inp) => inp.addEventListener('input', updateHint));
      updateHint();
    }
    form.querySelector('[name="setType"]').addEventListener('change', renderFields);
    renderFields();
  }

  const logBtn = el('button', { class: 'btn btn-primary', style: 'margin-top: 12px;' }, [
    el('span', { class: 'btn-title', text: 'LOG SET' }),
    el('span', { class: 'btn-sub', text: 'START REST TIMER' }),
  ]);
  logBtn.addEventListener('click', async () => {
    if (isCardio) {
      const machine = form.querySelector('[name="machine"]').value;
      const conf = CARDIO_MACHINES[machine] || CARDIO_MACHINES.other;
      set.actualMachine = machine;
      for (const f of conf.fields) {
        const raw = form.querySelector(`[name="${f.key}"]`)?.value;
        set[`actual${cap(f.key)}`] = raw ? Number(raw) : null;
      }
      const d = form.querySelector('[name="duration"]').value;
      const dist = form.querySelector('[name="distance"]').value;
      set.actualDurationSec = d ? Math.round(Number(d) * 60) : null;
      // Distance: use user value if given, else auto-calc from speed × time when possible.
      if (dist) {
        set.actualDistanceMi = Number(dist);
      } else if (conf.distanceFromSpeed && set.actualSpeedMph != null && set.actualDurationSec) {
        set.actualDistanceMi = Math.round(set.actualSpeedMph * (set.actualDurationSec / 3600) * 100) / 100;
      } else {
        set.actualDistanceMi = null;
      }
    } else if (isDuration) {
      const d = form.querySelector('[name="duration"]').value;
      set.actualDurationSec = d ? Math.round(Number(d) * 60) : null;
      set.type = form.querySelector('[name="setType"]')?.value || set.type || 'normal';
      set.notes = form.querySelector('[name="setNotes"]')?.value.trim() || '';
    } else {
      const t = form.querySelector('[name="setType"]')?.value || 'normal';
      set.type = t;
      set.notes = form.querySelector('[name="setNotes"]')?.value.trim() || '';
      if (t === 'single_side') {
        const repsL = form.querySelector('[name="repsL"]').value;
        const repsR = form.querySelector('[name="repsR"]').value;
        const weightL = form.querySelector('[name="weightL"]').value;
        const weightR = form.querySelector('[name="weightR"]').value;
        set.actualRepsL = repsL ? Number(repsL) : null;
        set.actualRepsR = repsR ? Number(repsR) : null;
        set.actualWeightLbL = weightL ? Number(weightL) : null;
        set.actualWeightLbR = weightR ? Number(weightR) : null;
        // Also populate the standard fields with the max side, so PR detection
        // and progression charts keep working without special-casing.
        set.actualReps     = Math.max(set.actualRepsL ?? 0, set.actualRepsR ?? 0) || null;
        set.actualWeightLb = Math.max(set.actualWeightLbL ?? 0, set.actualWeightLbR ?? 0) || null;
      } else {
        const r = form.querySelector('[name="reps"]').value;
        const w = form.querySelector('[name="weight"]').value;
        set.actualReps = r ? Number(r) : null;
        set.actualWeightLb = w ? Number(w) : null;
        // Clear per-side fields when returning to normal mode
        set.actualRepsL = null; set.actualRepsR = null;
        set.actualWeightLbL = null; set.actualWeightLbR = null;
      }
    }
    set.done = true;
    set.doneAt = new Date().toISOString();
    await db.put('sessions', session);
    document.getElementById('inspector-scrim').hidden = true;
    startRestTimer(current.restBetweenSets || 60);
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

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

const SET_TYPES = [
  { value: 'normal',      label: 'NORMAL' },
  { value: 'warmup',      label: 'WARM-UP' },
  { value: 'failure',     label: 'TO FAILURE' },
  { value: 'dropset',     label: 'DROPSET' },
  { value: 'single_side', label: 'SINGLE SIDE (L / R)' },
];

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
  confirmModal('DISCARD WORKOUT?', 'Delete this workout without saving. Sets logged so far will be lost.', async () => {
    clearInterval(elapsedTimerId); clearInterval(restTimerId);
    await db.remove('sessions', session.id);
    toast('WORKOUT DISCARDED', 'ok');
    window.location.hash = '#/home';
  });
}
// v0.8.0 · One-step save: popup with totals + optional notes, then SAVE.
function openFinishModal(session) {
  const all = (session.exercises || []).flatMap((ex) => ex.sets || []);
  const done = all.filter((st) => st.done).length;
  const durationMin = Math.round((Date.now() - new Date(session.startedAt).getTime()) / 60000);
  document.getElementById('inspector-title').textContent = 'FINISH & SAVE';
  const body = document.getElementById('inspector-body');
  body.innerHTML = '';
  body.appendChild(el('div', { class: 'finish-totals', text: `${done} OF ${all.length} SETS LOGGED  ·  ${durationMin} MIN` }));
  if (done < all.length) {
    body.appendChild(el('div', { class: 'form-hint', text: 'SETS NOT MARKED DONE WILL NOT COUNT.' }));
  }
  const form = el('div', { class: 'form-stack' }, [
    formTextarea('NOTES (OPTIONAL)', 'notes', session.notes || '', 'How did it feel?', 3),
  ]);
  body.appendChild(form);
  const saveBtn = el('button', { class: 'btn btn-primary', style: 'margin-top: 12px;' }, [
    el('span', { class: 'btn-title', text: 'SAVE WORKOUT' }),
  ]);
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    clearInterval(elapsedTimerId); clearInterval(restTimerId);
    session.notes = form.querySelector('[name="notes"]').value.trim();
    session.prs = await computePRs(session);
    session.completedAt = new Date().toISOString();
    session.isActive = false;
    await db.put('sessions', session);
    await maybeAdvancePushupLadder(session);
    document.getElementById('inspector-scrim').hidden = true;
    toast(`WORKOUT SAVED  ·  ${done} SETS`, 'ok', 3000);
    const target = `#/session/${session.id}`;
    if (window.location.hash === target) refresh(); else window.location.hash = target;
  });
  const backBtn = el('button', { class: 'btn btn-outline', style: 'margin-top: 8px;' }, [
    el('span', { class: 'btn-title', text: 'KEEP GOING' }),
  ]);
  backBtn.addEventListener('click', () => { document.getElementById('inspector-scrim').hidden = true; });
  body.appendChild(saveBtn);
  body.appendChild(backBtn);
  document.getElementById('inspector-scrim').hidden = false;
}
async function refresh() { const m = await import('./app.js?v=23'); m.refresh && m.refresh(); }

// ---------- SESSION SUMMARY ----------
async function renderSessionSummary(container, session) {
  const startedAt = new Date(session.startedAt);
  const completedAt = session.completedAt ? new Date(session.completedAt) : new Date();
  const durationMin = Math.round((completedAt - startedAt) / 60000);
  const totalSets = (session.exercises || []).reduce((n, ex) => n + (ex.sets || []).filter((s) => s.done).length, 0);
  const totalExercises = (session.exercises || []).filter((ex) => (ex.sets || []).some((s) => s.done)).length;
  const prs = session.prs || [];

  container.appendChild(el('section', { class: 'hero' }, [
    el('div', { class: 'eyebrow' }, [
      el('a', { href: '#/log', class: 'crumb', text: '‹ LOG' }),
      el('span', { text: '  ·  SAVED WORKOUT' }),
    ]),
    el('h1', { text: session.routineName || '(session)' }),
    el('p', { class: 'hero-meta', text: `${formatDate(session.completedAt || session.startedAt)}  ·  ${durationMin} MIN  ·  ${totalSets} SETS  ·  ${totalExercises} EXERCISES` }),
  ]));

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
  if (exList.children.length === 0) exList.appendChild(el('div', { class: 'empty-note', text: 'NO SETS LOGGED' }));
  container.appendChild(section('EXERCISES DONE', exList));

  if (session.notes) container.appendChild(section('NOTES', el('div', { class: 'note-block', text: session.notes })));
  if (session.cardioCalories != null || session.strengthCalories != null) {
    const infoCard = el('div', { class: 'settings-list' });
    if (session.cardioCalories != null) infoCard.appendChild(el('div', { class: 'settings-row' }, [
      el('span', { class: 'settings-key', text: 'CARDIO CALORIES (LEGACY)' }),
      el('span', { class: 'settings-value', text: String(session.cardioCalories) }),
    ]));
    if (session.strengthCalories != null) infoCard.appendChild(el('div', { class: 'settings-row' }, [
      el('span', { class: 'settings-key', text: 'STRENGTH CALORIES (LEGACY)' }),
      el('span', { class: 'settings-value', text: String(session.strengthCalories) }),
    ]));
    container.appendChild(section('DETAILS', infoCard));
  }

  container.appendChild(section('ACTIONS', el('div', { class: 'action-stack' }, [
    el('button', { class: 'btn btn-outline', onclick: () => openEditPastSession(session) }, [
      el('span', { class: 'btn-title', text: 'EDIT DETAILS' }),
      el('span', { class: 'btn-sub', text: 'DATE · NOTES' }),
    ]),
    el('button', { class: 'btn btn-danger', onclick: () => confirmDeleteSession(session, '#/log') }, [
      el('span', { class: 'btn-title', text: 'DELETE WORKOUT' }),
      el('span', { class: 'btn-sub', text: 'REMOVES IT FROM YOUR LOG' }),
    ]),
  ])));
}

export function confirmDeleteSession(session, goTo) {
  confirmModal('DELETE WORKOUT?',
    `Delete "${session.routineName || 'workout'}" from ${formatDate(session.completedAt || session.startedAt)}? This cannot be undone.`,
    async () => {
      await db.remove('sessions', session.id);
      toast('WORKOUT DELETED', 'ok');
      if (goTo && window.location.hash !== goTo) window.location.hash = goTo;
      else refresh();
    });
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

// v0.6.0 · Edit calories, notes, or date on a completed session.
function openEditPastSession(session) {
  document.getElementById('inspector-title').textContent = 'EDIT SESSION';
  const body = document.getElementById('inspector-body');
  body.innerHTML = '';
  const form = el('div', { class: 'form-stack' });
  const dateVal = (session.completedAt || '').slice(0, 10);
  form.appendChild(formField('DATE (YYYY-MM-DD)', 'date', 'date', dateVal, ''));
  form.appendChild(formTextarea('NOTES', 'notes', session.notes || '', ''));

  const saveBtn = el('button', { class: 'btn btn-primary', style: 'margin-top: 12px;' }, [
    el('span', { class: 'btn-title', text: 'SAVE CHANGES' }),
  ]);
  saveBtn.addEventListener('click', async () => {
    const d = form.querySelector('[name="date"]').value;
    if (d) {
      const prevTime = (session.completedAt || '').slice(10) || 'T12:00:00.000Z';
      session.completedAt = d + prevTime;
    }
    session.notes = form.querySelector('[name="notes"]').value.trim();
    await db.put('sessions', session);
    document.getElementById('inspector-scrim').hidden = true;
    toast('SESSION UPDATED', 'ok');
    refresh();
  });
  body.appendChild(form);
  body.appendChild(saveBtn);
  document.getElementById('inspector-scrim').hidden = false;
}

// v0.6.0 · If the last N sessions all hit target reps on push-ups, bump the goal phase.
async function maybeAdvancePushupLadder(justSavedSession) {
  const goal = await db.get('goals', 'gl_pushup');
  if (!goal || !goal.metadata) return;
  const phases = goal.metadata.phases || [];
  const idx = goal.metadata.currentPhaseIndex ?? 0;
  if (idx >= phases.length - 1) return;
  // Find push-up-like exercises in this and past sessions
  const sessions = (await db.getAll('sessions')).filter((s) => !s.isActive && s.completedAt)
    .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));
  const isPushup = (name) => /push[- ]?up/i.test(name || '');
  // Consider last 3 sessions with any push-up work
  let clean = 0;
  for (const s of sessions) {
    const ex = (s.exercises || []).find((e) => isPushup(e.exerciseName));
    if (!ex) continue;
    const done = (ex.sets || []).filter((st) => st.done && st.actualReps != null);
    if (done.length === 0) continue;
    const allHit = done.length >= 3 && done.every((st) => st.actualReps >= 12);
    if (allHit) clean++;
    else break;
    if (clean >= 3) {
      goal.metadata.currentPhaseIndex = idx + 1;
      goal.updatedAt = new Date().toISOString();
      await db.put('goals', goal);
      toast(`◆ PUSH-UP LADDER · ADVANCED TO ${phases[idx + 1].toUpperCase()}`, 'ok', 4000);
      return;
    }
  }
}
