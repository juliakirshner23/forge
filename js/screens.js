// FORGE screens: home, plan, routine detail, library, exercise, me
import * as db from './db.js?v=13';
import { downloadBackup, restoreFromBackupJson } from './export.js?v=13';
import { importBundledHevyBackup, importHevyJson } from './import.js?v=13';
import {
  el, section, notFound, formField, formSelect, formTextarea,
  catBadge, focusTagEl, progressBar,
  DAY_ORDER, DAY_LABELS, DAY_FULL, CATEGORIES,
  currentDayKey, daysUntil, formatDuration, esc, uid,
  toast, confirmModal, openPicker, getActiveSession,
} from './ui.js?v=13';

// ---------- HOME ----------
export async function renderHome(container) {
  const dayKey = currentDayKey();
  const [routines, measurements, goals, sessions] = await Promise.all([
    db.getAll('routines'), db.getAll('bodyMeasurements'), db.getAll('goals'), db.getAll('sessions'),
  ]);
  const todaysRoutines = routines.filter((r) => r.scheduledDay === dayKey && r.isActive !== false);
  const latestWeight = measurements.length
    ? [...measurements].sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0] : null;
  const activeSession = sessions.find((s) => s.isActive === true) || null;
  const completedSessions = sessions.filter((s) => !s.isActive && s.completedAt);
  const inca = goals.find((g) => g.id === 'gl_inca_trail');
  const weightGoal = goals.find((g) => g.id === 'gl_weight');
  const pushupGoal = goals.find((g) => g.id === 'gl_pushup');

  container.appendChild(el('section', { class: 'hero' }, [
    el('div', { class: 'eyebrow', text: `${DAY_FULL[dayKey]}  ·  ${new Date().toDateString().toUpperCase()}` }),
    el('h1', { text: 'TODAY' }),
  ]));

  if (activeSession) {
    container.appendChild(section('IN PROGRESS',
      el('a', { class: 'today-card', href: `#/session/${activeSession.id}`, style: 'border-color: var(--green);' }, [
        el('div', { class: 'today-label', style: 'color: var(--green);', text: 'RESUME WORKOUT' }),
        el('div', { class: 'today-name', text: activeSession.routineName || '(session)' }),
        el('div', { class: 'today-meta', text: `STARTED ${new Date(activeSession.startedAt).toLocaleTimeString()}` }),
        el('div', { class: 'today-cta', style: 'color: var(--green);', text: 'RESUME →' }),
      ])
    ));
  }

  let todayCard;
  if (todaysRoutines.length === 0) {
    todayCard = el('div', { class: 'today-card today-rest' }, [
      el('div', { class: 'today-label', text: 'REST DAY' }),
      el('div', { class: 'today-sub', text: 'NO ROUTINE SCHEDULED FOR TODAY' }),
    ]);
  } else {
    const r = todaysRoutines[0];
    todayCard = el('a', { class: 'today-card', href: `#/routine/${r.id}` }, [
      el('div', { class: 'today-label', text: "TODAY'S WORKOUT" }),
      el('div', { class: 'today-name', text: r.name }),
      el('div', { class: 'tag-row' }, (r.focusTags || []).map(focusTagEl)),
      el('div', { class: 'today-meta', text: `${(r.exercises || []).length} EXERCISES  ·  TAP TO VIEW` }),
      el('div', { class: 'today-cta', text: 'GO →' }),
    ]);
  }
  container.appendChild(section("TODAY'S WORKOUT", todayCard));

  container.appendChild(section('THIS WEEK', weeklyAdherence(completedSessions, routines)));

  // v0.6.0 · recent PRs from last completed session (celebration)
  const lastCompleted = completedSessions.slice().sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''))[0];
  if (lastCompleted && (lastCompleted.prs || []).length > 0) {
    const isRecent = (Date.now() - new Date(lastCompleted.completedAt).getTime()) < 3 * 86400000;
    if (isRecent) {
      container.appendChild(await renderRecentPrsCard(lastCompleted));
    }
  }

  // v0.6.0 · progression prompts + weekly digest
  container.appendChild(await renderProgressionSection(completedSessions));

  const missions = [];
  if (weightGoal) missions.push(weightMissionCard(weightGoal, latestWeight));
  if (pushupGoal) missions.push(pushupMissionCard(pushupGoal));
  if (inca?.targetDate) missions.push(countdownCard('◆ INCA TRAIL', inca.targetDate, inca.metadata?.description));
  if (missions.length > 0) container.appendChild(section('MISSIONS', el('div', { class: 'mission-stack' }, missions)));

  container.appendChild(await stepsCardSection());

  container.appendChild(section('QUICK STATS', el('div', { class: 'stat-strip' }, [
    statMini('WEIGHT', latestWeight?.weight != null ? latestWeight.weight : '—', latestWeight?.weight != null ? 'LB' : ''),
    statMini('SESSIONS', completedSessions.length, 'LOGGED'),
    statMini('GOALS', goals.length, 'TRACKED'),
  ])));
}

async function renderRecentPrsCard(session) {
  const list = el('div', {}, (session.prs || []).slice(0, 5).map((pr) =>
    el('div', { class: 'pr-row' }, [
      el('span', { class: 'pr-star', text: '★' }),
      el('div', { class: 'pr-main' }, [
        el('div', { class: 'pr-name', text: pr.exerciseName }),
        el('div', { class: 'pr-meta', text: `${(pr.type || '').toUpperCase()} · ${pr.value}` }),
      ]),
    ])
  ));
  return section('◆ NEW PERSONAL BESTS', el('div', { class: 'pr-card' }, [list]));
}

async function renderProgressionSection(sessions) {
  const { suggestProgression, detectPlateau, detectRotation } = await import('./progression.js?v=13');
  const sensitivity = await db.getSetting('promptSensitivity', 'balanced');
  const sessionsNewestFirst = sessions.slice().sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));
  // Gather unique exerciseIds with recent activity
  const seen = new Set();
  for (const s of sessionsNewestFirst.slice(0, 20)) {
    for (const ex of (s.exercises || [])) if (ex.exerciseName) seen.add(ex.exerciseId);
  }
  const prompts = [];
  const seenIds = [...seen];
  for (const id of seenIds) {
    const ex = sessionsNewestFirst.find((s) => (s.exercises || []).some((e) => e.exerciseId === id))
      ?.exercises.find((e) => e.exerciseId === id);
    if (!ex) continue;
    const prog = suggestProgression(id, sessionsNewestFirst, sensitivity);
    if (prog) {
      prompts.push({ kind: 'increase', name: ex.exerciseName, text: `TRY ${prog.target} LB NEXT · ${prog.reason}` });
      continue;
    }
    const plateau = detectPlateau(id, sessionsNewestFirst, 4);
    if (plateau && prompts.filter((p) => p.kind === 'plateau').length < 2) {
      prompts.push({ kind: 'plateau', name: ex.exerciseName, text: `PLATEAU · NO PR IN ${plateau.weeks} WEEKS AT ${plateau.maxWeight} LB. CONSIDER DELOAD OR SWAP.` });
      continue;
    }
    const rot = detectRotation(id, sessionsNewestFirst, 8);
    if (rot && prompts.filter((p) => p.kind === 'rotation').length < 2) {
      prompts.push({ kind: 'rotation', name: ex.exerciseName, text: `${rot.weeksInARow} WEEKS ON THIS EXERCISE. TRY A VARIATION.` });
    }
  }
  if (prompts.length === 0) {
    return el('div', {});
  }
  const list = el('div', { class: 'prompt-stack' }, prompts.slice(0, 4).map((p) =>
    el('div', { class: `prompt-card prompt-${p.kind}` }, [
      el('div', { class: 'prompt-kind', text: p.kind === 'increase' ? '↑ PROGRESSION' : p.kind === 'plateau' ? '◆ PLATEAU' : '◇ ROTATION' }),
      el('div', { class: 'prompt-name', text: p.name }),
      el('div', { class: 'prompt-text', text: p.text }),
    ])
  ));
  return section('SUGGESTIONS', list);
}

async function stepsCardSection() {
  const [strideIn, stepGoal] = await Promise.all([
    db.getSetting('strideLengthIn', 30),
    db.getSetting('stepGoal', 10000),
  ]);
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  const todayIso = `${y}-${m}-${d}`;
  const existing = await db.get('dailyActivity', todayIso);
  const steps = existing?.steps ?? null;

  const distMi = steps != null ? Math.round((steps * strideIn) / 63360 * 100) / 100 : null;
  const pct = stepGoal > 0 && steps != null ? Math.min(100, (steps / stepGoal) * 100) : 0;

  const stepsInput = el('input', {
    class: 'form-input', type: 'number', name: 'steps',
    value: steps ?? '', placeholder: 'e.g. 8500',
  });
  const distDisplay = el('span', { class: 'steps-dist', text: distMi != null ? `${distMi} MI` : '—' });

  stepsInput.addEventListener('input', () => {
    const v = Number(stepsInput.value);
    const md = v && strideIn ? Math.round((v * strideIn) / 63360 * 100) / 100 : null;
    distDisplay.textContent = md != null ? `${md} MI` : '—';
  });

  const saveBtn = el('button', { class: 'btn btn-primary' }, [
    el('span', { class: 'btn-title', text: 'SAVE TODAY' }),
    el('span', { class: 'btn-sub', text: 'STORES IN DAILY ACTIVITY' }),
  ]);
  saveBtn.addEventListener('click', async () => {
    const v = Number(stepsInput.value);
    if (!v || v < 0) { const { toast } = await import('./ui.js?v=13'); toast('ENTER A STEP COUNT', 'error'); return; }
    const dist = strideIn ? Math.round((v * strideIn) / 63360 * 100) / 100 : null;
    await db.put('dailyActivity', {
      date: todayIso, steps: v, distanceMi: dist,
      strideLengthIn: strideIn, updatedAt: new Date().toISOString(),
    });
    const { toast } = await import('./ui.js?v=13');
    toast(`SAVED · ${v.toLocaleString()} STEPS · ${dist} MI`, 'ok');
  });

  const card = el('div', { class: 'steps-card' }, [
    el('div', { class: 'steps-row' }, [
      el('div', { class: 'steps-col' }, [
        el('span', { class: 'steps-label', text: 'STEPS TODAY' }),
        stepsInput,
      ]),
      el('div', { class: 'steps-col steps-col-dist' }, [
        el('span', { class: 'steps-label', text: 'DISTANCE' }),
        distDisplay,
      ]),
    ]),
    el('div', { class: 'steps-goal-row' }, [
      el('span', { class: 'steps-label', text: `GOAL ${stepGoal.toLocaleString()}` }),
      el('span', { class: 'steps-goal-pct', text: `${Math.round(pct)}%` }),
    ]),
    el('div', { class: 'pbar' }, [
      el('div', { class: 'pbar-fill', style: `width:${pct}%;background:var(--amber);` }),
    ]),
    saveBtn,
  ]);
  return section('DAILY STEPS', card);
}

function statMini(label, value, sub) {
  return el('div', { class: 'stat-mini' }, [
    el('span', { class: 'stat-mini-label', text: label }),
    el('span', { class: 'stat-mini-value', text: value }),
    el('span', { class: 'stat-mini-sub', text: sub }),
  ]);
}

function weeklyAdherence(completedSessions, routines) {
  const now = new Date();
  const dow = now.getDay();
  const daysSinceMon = (dow + 6) % 7;
  const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMon);
  const activeByDay = {};
  for (const r of routines.filter((r) => r.isActive !== false && r.scheduledDay)) activeByDay[r.scheduledDay] = true;

  const wrap = el('div', { class: 'week-dots' });
  for (let i = 0; i < 7; i++) {
    const dayDate = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i);
    const dayIso = dayDate.toISOString().slice(0, 10);
    const dayKey = DAY_ORDER[i];
    const scheduled = !!activeByDay[dayKey];
    const done = completedSessions.some((s) => s.completedAt && s.completedAt.slice(0, 10) === dayIso);
    const isFuture = dayDate > now;
    const isToday = dayDate.toDateString() === now.toDateString();
    let cls = 'week-dot';
    if (done) cls += ' week-dot-done';
    else if (isFuture && scheduled) cls += ' week-dot-scheduled';
    else if (!isFuture && scheduled) cls += ' week-dot-missed';
    else cls += ' week-dot-rest';
    if (isToday) cls += ' week-dot-today';
    wrap.appendChild(el('div', { class: cls }, [
      el('span', { class: 'week-dot-day', text: DAY_LABELS[dayKey] }),
      el('span', { class: 'week-dot-mark', text: done ? '✓' : (isFuture && scheduled) ? '◇' : (!isFuture && scheduled) ? '×' : '·' }),
    ]));
  }
  return wrap;
}

function weightMissionCard(goal, latestMeasurement) {
  const start = goal.startValue ?? 0;
  const target = goal.targetValue ?? 0;
  const current = latestMeasurement?.weight ?? start;
  const totalDelta = start - target;
  const doneDelta = start - current;
  const pct = totalDelta > 0 ? Math.max(0, Math.min(100, (doneDelta / totalDelta) * 100)) : 0;
  const days = goal.targetDate ? daysUntil(goal.targetDate) : null;
  // Milestones: 5/10/15/20/25 lb steps, then 10 lb steps to goal
  const stops = [];
  for (const s of [5, 10, 15, 20, 25]) if (s <= totalDelta) stops.push(s);
  let n = 30;
  while (n <= totalDelta) { stops.push(n); n += 10; }
  if (totalDelta > 0 && !stops.includes(totalDelta)) stops.push(totalDelta);
  const done = Math.max(0, doneDelta);
  return el('div', { class: 'mission-card' }, [
    el('div', { class: 'mission-header' }, [
      el('span', { class: 'mission-title', text: '◆ WEIGHT GOAL' }),
      days != null ? el('span', { class: 'mission-days', text: `${days}D` }) : null,
    ]),
    el('div', { class: 'mission-metrics' }, [
      el('span', { class: 'mission-current', text: `${current} LB` }),
      el('span', { class: 'mission-target', text: `→ ${target} LB` }),
    ]),
    progressBar(pct, { label: 'PROGRESS', value: `${Math.round(pct)}%` }),
    stops.length > 0
      ? el('div', { class: 'milestone-row' }, stops.map((lb) => {
          const hit = done >= lb;
          const cls = 'milestone-chip' + (hit ? ' milestone-chip-hit' : '');
          return el('span', { class: cls, text: `${hit ? '✓ ' : ''}${lb}LB` });
        }))
      : null,
  ]);
}

function pushupMissionCard(goal) {
  const phases = goal.metadata?.phases || ['wall', 'high incline', 'mid incline', 'low incline', 'full'];
  const phaseIdx = goal.metadata?.currentPhaseIndex ?? 0;
  const pct = phases.length > 0 ? ((phaseIdx + 1) / phases.length) * 100 : 0;
  const days = goal.targetDate ? daysUntil(goal.targetDate) : null;
  return el('div', { class: 'mission-card' }, [
    el('div', { class: 'mission-header' }, [
      el('span', { class: 'mission-title', text: '◆ PUSH-UP LADDER' }),
      days != null ? el('span', { class: 'mission-days', text: `${days}D` }) : null,
    ]),
    el('div', { class: 'push-ladder' },
      phases.map((p, i) => el('span', {
        class: 'push-rung' + (i <= phaseIdx ? ' push-rung-done' : '') + (i === phaseIdx ? ' push-rung-current' : ''),
        text: p.toUpperCase().slice(0, 6),
      }))
    ),
    progressBar(pct, { label: `PHASE ${phaseIdx + 1} OF ${phases.length}`, value: (phases[phaseIdx] || '').toUpperCase() }),
  ]);
}

function countdownCard(label, targetDate, sub) {
  const days = daysUntil(targetDate);
  return el('div', { class: 'mission-card' }, [
    el('div', { class: 'mission-header' }, [
      el('span', { class: 'mission-title', text: label }),
      el('span', { class: 'mission-days', text: `${days}D` }),
    ]),
    el('div', { class: 'mission-metrics' }, [
      el('span', { class: 'mission-current', text: targetDate }),
    ]),
    sub ? el('div', { class: 'mission-sub', text: sub }) : null,
  ]);
}

// ---------- PLAN ----------
export async function renderPlan(container) {
  const routines = await db.getAll('routines');
  const activeRoutines = routines.filter((r) => r.isActive !== false);
  const byDay = {};
  for (const key of DAY_ORDER) byDay[key] = [];
  const unscheduled = [];
  for (const r of activeRoutines) {
    if (r.scheduledDay && DAY_ORDER.includes(r.scheduledDay)) byDay[r.scheduledDay].push(r);
    else unscheduled.push(r);
  }
  const todayKey = currentDayKey();

  container.appendChild(el('section', { class: 'hero' }, [
    el('div', { class: 'eyebrow', text: `WEEKLY PROGRAM  ·  ${activeRoutines.length} ROUTINES` }),
    el('h1', { text: 'THIS WEEK' }),
    el('p', { class: 'hero-sub', text: 'Tap a day to see its routine and exercises.' }),
  ]));

  const dayList = el('div', { class: 'day-list' });
  for (const key of DAY_ORDER) dayList.appendChild(dayCard(key, byDay[key], key === todayKey));
  container.appendChild(section('SCHEDULE', dayList));

  if (unscheduled.length > 0) {
    const others = el('div', { class: 'day-list' });
    for (const r of unscheduled) others.appendChild(routineRow(r));
    container.appendChild(section(`UNSCHEDULED  ·  ${unscheduled.length}`, others));
  }

  container.appendChild(section('ACTIONS', el('div', { class: 'action-stack' }, [
    el('a', { class: 'btn btn-primary', href: '#/routine/new' }, [
      el('span', { class: 'btn-title', text: '+ NEW ROUTINE' }),
      el('span', { class: 'btn-sub', text: 'CREATE A CUSTOM WORKOUT' }),
    ]),
    el('a', { class: 'btn btn-outline', href: '#/library' }, [
      el('span', { class: 'btn-title', text: 'EXERCISE LIBRARY' }),
      el('span', { class: 'btn-sub', text: 'BROWSE, EDIT, AND ORGANIZE YOUR EXERCISES' }),
    ]),
  ])));
}

function dayCard(dayKey, routines, isToday) {
  const cardClass = `day-card ${isToday ? 'day-today' : ''} ${routines.length === 0 ? 'day-rest' : ''}`;
  const children = [
    el('div', { class: 'day-col' }, [
      el('div', { class: 'day-name', text: DAY_LABELS[dayKey] }),
      isToday ? el('div', { class: 'day-tag', text: 'TODAY' }) : null,
    ]),
  ];
  if (routines.length === 0) {
    children.push(el('div', { class: 'day-body' }, [ el('div', { class: 'day-empty', text: 'REST' }) ]));
  } else {
    const body = el('div', { class: 'day-body' });
    for (const r of routines) {
      body.appendChild(el('a', { class: 'day-routine-link', href: `#/routine/${r.id}` }, [
        el('div', { class: 'day-routine-name', text: r.name }),
        el('div', { class: 'tag-row day-tag-row' }, (r.focusTags || []).map(focusTagEl)),
        el('div', { class: 'day-routine-meta', text: `${(r.exercises || []).length} EXERCISES` }),
      ]));
    }
    children.push(body);
  }
  return el('div', { class: cardClass }, children);
}

function routineRow(r) {
  return el('a', { class: 'nav-row', href: `#/routine/${r.id}` }, [
    el('div', { class: 'nav-row-main' }, [
      el('div', { class: 'nav-row-title', text: r.name }),
      el('div', { class: 'nav-row-sub', text: `${(r.exercises || []).length} EXERCISES${r.folderName ? '  ·  ' + r.folderName.toUpperCase() : ''}` }),
    ]),
    el('div', { class: 'nav-row-arrow', text: '›' }),
  ]);
}

// ---------- ROUTINE (view; edit lives in routine-editor.js) ----------
export async function renderRoutine(container, params) {
  const [routineId, action] = params;
  if (routineId === 'new') {
    const { renderRoutineEditor } = await import('./routine-editor.js?v=13');
    return renderRoutineEditor(container, null);
  }
  const routine = routineId ? await db.get('routines', routineId) : null;
  if (!routine) { container.appendChild(notFound('ROUTINE NOT FOUND', '#/plan', 'PLAN')); return; }
  if (action === 'edit') {
    const { renderRoutineEditor } = await import('./routine-editor.js?v=13');
    return renderRoutineEditor(container, routine);
  }
  return renderRoutineDetail(container, routine);
}

async function renderRoutineDetail(container, routine) {
  const allExercises = await db.getAll('exercises');
  const exById = new Map(allExercises.map((e) => [e.id, e]));
  const activeSession = await getActiveSession();

  container.appendChild(el('section', { class: 'hero' }, [
    el('div', { class: 'eyebrow' }, [
      el('a', { href: '#/plan', class: 'crumb', text: '‹ PLAN' }),
      el('span', { text: '  ·  ' + (routine.folderName || 'ROUTINE').toUpperCase() }),
    ]),
    el('h1', { text: routine.name }),
    el('p', { class: 'hero-meta', text: `${routine.scheduledDay ? DAY_FULL[routine.scheduledDay] + '  ·  ' : ''}${(routine.exercises || []).length} EXERCISES` }),
    (routine.focusTags && routine.focusTags.length > 0)
      ? el('div', { class: 'tag-row', style: 'margin-top: 12px;' }, routine.focusTags.map(focusTagEl))
      : null,
  ]));

  const exercises = routine.exercises || [];
  if (exercises.length === 0) {
    container.appendChild(section('EXERCISES', el('div', { class: 'empty-note', text: 'NO EXERCISES IN THIS ROUTINE' })));
  } else {
    const list = el('div', { class: 'exercise-list' });
    exercises.forEach((ex, idx) => {
      const libEx = exById.get(ex.exerciseId);
      list.appendChild(exerciseRow(ex, idx, libEx?.category || 'strength', libEx));
    });
    container.appendChild(section(`EXERCISES  ·  ${exercises.length}`, list));
  }

  const isActiveForThis = activeSession && activeSession.routineId === routine.id;
  const isActiveOther = activeSession && activeSession.routineId !== routine.id;
  const startBtn = el('button', { class: 'btn btn-primary' }, [
    el('span', { class: 'btn-title', text: isActiveForThis ? 'RESUME WORKOUT' : 'START WORKOUT' }),
    el('span', { class: 'btn-sub', text: isActiveForThis ? 'CONTINUE ACTIVE SESSION' : isActiveOther ? '⚠ ANOTHER SESSION IS ACTIVE' : 'BEGIN LOGGING SETS' }),
  ]);
  startBtn.addEventListener('click', () => onStartWorkoutClick(routine, activeSession));

  const editBtn = el('a', { class: 'btn btn-outline', href: `#/routine/${routine.id}/edit` }, [
    el('span', { class: 'btn-title', text: 'EDIT ROUTINE' }),
    el('span', { class: 'btn-sub', text: 'CHANGE EXERCISES, SETS, DAY, TAGS' }),
  ]);
  container.appendChild(section('ACTIONS', el('div', { class: 'action-stack' }, [startBtn, editBtn])));
}

async function onStartWorkoutClick(routine, activeSession) {
  const { startSession } = await import('./workout.js?v=13');
  if (activeSession) {
    if (activeSession.routineId === routine.id) { window.location.hash = `#/session/${activeSession.id}`; return; }
    confirmModal('ANOTHER SESSION IS ACTIVE',
      `You have an active session for "${activeSession.routineName}". Starting a new one will abandon it. Continue?`,
      async () => {
        await db.remove('sessions', activeSession.id);
        const s = await startSession(routine);
        window.location.hash = `#/session/${s.id}`;
      });
    return;
  }
  const s = await startSession(routine);
  window.location.hash = `#/session/${s.id}`;
}

function exerciseRow(ex, idx, category, libEx) {
  const setsCount = (ex.sets || []).length;
  const firstSet = (ex.sets || [])[0];
  let setsSummary = `${setsCount} SET${setsCount === 1 ? '' : 'S'}`;
  if (firstSet) {
    if (firstSet.durationSec != null) setsSummary += `  ·  ${formatDuration(firstSet.durationSec)}`;
    else if (firstSet.reps != null) {
      setsSummary += ` × ${firstSet.reps}`;
      if (firstSet.weightLb != null) setsSummary += `  ·  ${firstSet.weightLb} LB`;
    }
  }
  if (ex.restBetweenSets) setsSummary += `  ·  REST ${ex.restBetweenSets}S`;
  const constraintFlag = libEx?.constraintFlags?.length > 0;
  return el('div', { class: 'exercise-row' }, [
    el('div', { class: 'exercise-num', text: idx + 1 }),
    catBadge(category),
    el('div', { class: 'exercise-main' }, [
      el('div', { class: 'exercise-name', text: ex.exerciseName || libEx?.name || '(deleted)' }),
      el('div', { class: 'exercise-meta', text: setsSummary }),
    ]),
    constraintFlag ? el('div', { class: 'exercise-flag', text: '⚑' }) : null,
  ]);
}

// ---------- LIBRARY + EXERCISE (unchanged from phase 2b, just wired up) ----------
const KNOWN_FLAGS = [
  { id: 'plank', label: 'PLANK POSITION' },
  { id: 'heavy-legs', label: 'HEAVY LEGS' },
  { id: 'weight-bearing', label: 'WEIGHT-BEARING' },
  { id: 'standing-under-load', label: 'STANDING UNDER LOAD' },
  { id: 'user-disabled', label: 'DISABLED' },
  { id: 'user-flagged', label: 'USER-FLAGGED' },
];

export async function renderLibrary(container) {
  const allExercises = await db.getAll('exercises');
  const routines = await db.getAll('routines');
  const usage = new Map();
  for (const r of routines) for (const ex of (r.exercises || [])) usage.set(ex.exerciseId, (usage.get(ex.exerciseId) || 0) + 1);

  let categoryFilter = 'all', searchQuery = '', ptSafeOnly = false;

  container.appendChild(el('section', { class: 'hero' }, [
    el('div', { class: 'eyebrow', text: `EXERCISE LIBRARY  ·  ${allExercises.length} EXERCISES` }),
    el('h1', { text: 'YOUR LIBRARY' }),
  ]));

  const searchInput = el('input', { class: 'search-input', type: 'search', placeholder: 'SEARCH EXERCISES...' });
  container.appendChild(section('SEARCH', searchInput));

  const filterRow = el('div', { class: 'filter-row' });
  const catChips = [{ id: 'all', label: 'ALL' }, ...CATEGORIES.map((c) => ({ id: c, label: c.toUpperCase() }))];
  const chipEls = new Map();
  for (const c of catChips) {
    const chip = el('button', { class: 'filter-chip' + (c.id === 'all' ? ' filter-chip-active' : ''), text: c.label });
    chip.addEventListener('click', () => {
      categoryFilter = c.id;
      for (const [id, el2] of chipEls) el2.classList.toggle('filter-chip-active', id === c.id);
      updateList();
    });
    filterRow.appendChild(chip);
    chipEls.set(c.id, chip);
  }
  const ptChip = el('button', { class: 'filter-chip filter-chip-pt', text: '◉ PT SAFE ONLY' });
  ptChip.addEventListener('click', () => { ptSafeOnly = !ptSafeOnly; ptChip.classList.toggle('filter-chip-pt-on', ptSafeOnly); updateList(); });
  filterRow.appendChild(ptChip);
  container.appendChild(section('FILTERS', filterRow));

  const listWrap = el('div', {});
  const listCounter = el('div', { class: 'section-label' });
  const list = el('div', { class: 'exercise-list' });
  listWrap.appendChild(listCounter);
  listWrap.appendChild(list);
  container.appendChild(el('section', { class: 'section' }, [listWrap]));
  searchInput.addEventListener('input', () => { searchQuery = searchInput.value.trim().toLowerCase(); updateList(); });

  container.appendChild(section('ADD', el('a', { class: 'btn btn-primary', href: '#/exercise/new' }, [
    el('span', { class: 'btn-title', text: '+ CREATE CUSTOM EXERCISE' }),
    el('span', { class: 'btn-sub', text: 'MAKES A NEW EXERCISE YOU CAN USE IN ROUTINES' }),
  ])));

  function updateList() {
    let filtered = allExercises;
    if (categoryFilter !== 'all') filtered = filtered.filter((e) => e.category === categoryFilter);
    if (searchQuery) filtered = filtered.filter((e) => (e.name || '').toLowerCase().includes(searchQuery));
    if (ptSafeOnly) filtered = filtered.filter((e) => !(e.constraintFlags && e.constraintFlags.length > 0));
    filtered = [...filtered].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    listCounter.textContent = `SHOWING ${filtered.length} OF ${allExercises.length}`;
    list.innerHTML = '';
    if (filtered.length === 0) { list.appendChild(el('div', { class: 'empty-note', text: 'NO EXERCISES MATCH THESE FILTERS' })); return; }
    for (const ex of filtered) list.appendChild(libraryRow(ex, usage.get(ex.id) || 0));
  }
  updateList();
}

function libraryRow(ex, useCount) {
  const flagged = ex.constraintFlags && ex.constraintFlags.length > 0;
  return el('a', { class: 'exercise-row exercise-row-link', href: `#/exercise/${ex.id}` }, [
    catBadge(ex.category),
    el('div', { class: 'exercise-main' }, [
      el('div', { class: 'exercise-name' }, [
        document.createTextNode(ex.name),
        ex.isCustom ? el('span', { class: 'inline-badge', text: 'CUSTOM' }) : null,
      ]),
      el('div', { class: 'exercise-meta' }, [
        el('span', { text: ex.equipment || 'BODYWEIGHT' }),
        useCount > 0 ? el('span', { text: `  ·  IN ${useCount} ROUTINE${useCount === 1 ? '' : 'S'}` }) : null,
      ]),
    ]),
    flagged ? el('div', { class: 'exercise-flag', text: '⚑' }) : el('div', { class: 'nav-row-arrow', text: '›' }),
  ]);
}

export async function renderExercise(container, params) {
  const [idOrNew, action] = params;
  if (idOrNew === 'new') return renderExerciseForm(container, null);
  const exercise = await db.get('exercises', idOrNew);
  if (!exercise) { container.appendChild(notFound('EXERCISE NOT FOUND', '#/library', 'LIBRARY')); return; }
  if (action === 'edit') return renderExerciseForm(container, exercise);
  return renderExerciseDetail(container, exercise);
}

async function renderExerciseDetail(container, ex) {
  const routines = await db.getAll('routines');
  const uses = routines.filter((r) => (r.exercises || []).some((e) => e.exerciseId === ex.id));

  container.appendChild(el('section', { class: 'hero' }, [
    el('div', { class: 'eyebrow' }, [
      el('a', { href: '#/library', class: 'crumb', text: '‹ LIBRARY' }),
      el('span', { text: `  ·  ${(ex.category || 'strength').toUpperCase()}` }),
      uses.length > 0 ? el('span', { text: `  ·  IN ${uses.length} ROUTINE${uses.length === 1 ? '' : 'S'}` }) : null,
    ]),
    el('h1', { text: ex.name }),
    ex.equipment ? el('p', { class: 'hero-meta', text: ex.equipment.toUpperCase() }) : null,
  ]));

  container.appendChild(el('div', { class: 'tag-row', style: 'margin: 0 20px 20px;' }, [
    ex.isCustom ? el('span', { class: 'tag tag-neutral', text: 'CUSTOM' }) : el('span', { class: 'tag tag-neutral', text: 'FROM HEVY' }),
    (ex.constraintFlags && ex.constraintFlags.length > 0)
      ? el('span', { class: 'tag tag-flag', text: '⚑ FLAGGED' })
      : el('span', { class: 'tag tag-safe', text: '◉ PT SAFE' }),
  ]));

  const metaCard = el('div', { class: 'settings-list' });
  metaCard.appendChild(metaRow('CATEGORY', (ex.category || 'strength').toUpperCase()));
  metaCard.appendChild(metaRow('EQUIPMENT', (ex.equipment || 'BODYWEIGHT').toUpperCase()));
  metaCard.appendChild(metaRow('PRIMARY MUSCLES', (ex.primaryMuscles || []).join(', ') || '—'));
  metaCard.appendChild(metaRow('SECONDARY MUSCLES', (ex.secondaryMuscles || []).join(', ') || '—'));
  container.appendChild(section('METADATA', metaCard));

  if (ex.notes && ex.notes.trim()) container.appendChild(section('NOTES', el('div', { class: 'note-block', text: ex.notes })));
  container.appendChild(section('CONSTRAINT FLAGS', flagsEditor(ex)));

  if (uses.length > 0) {
    const usesList = el('div', {});
    for (const r of uses) {
      usesList.appendChild(el('a', { class: 'nav-row', href: `#/routine/${r.id}` }, [
        el('div', { class: 'nav-row-main' }, [
          el('div', { class: 'nav-row-title', text: r.name }),
          el('div', { class: 'nav-row-sub', text: r.folderName ? r.folderName.toUpperCase() : 'ROUTINE' }),
        ]),
        el('div', { class: 'nav-row-arrow', text: '›' }),
      ]));
    }
    container.appendChild(section(`USED IN  ·  ${uses.length}`, usesList));
  }

  container.appendChild(section('ACTIONS', el('div', { class: 'action-stack' }, [
    el('a', { class: 'btn btn-primary', href: `#/exercise/${ex.id}/edit` }, [
      el('span', { class: 'btn-title', text: 'EDIT EXERCISE' }),
      el('span', { class: 'btn-sub', text: 'CHANGE NAME, CATEGORY, EQUIPMENT, NOTES' }),
    ]),
    el('button', { class: 'btn btn-danger', onclick: () => onDeleteExercise(ex, uses) }, [
      el('span', { class: 'btn-title', text: 'DELETE EXERCISE' }),
      el('span', { class: 'btn-sub', text: uses.length > 0 ? `⚠ IN ${uses.length} ROUTINE${uses.length === 1 ? '' : 'S'}` : 'IRREVERSIBLE' }),
    ]),
  ])));
}

function metaRow(key, value) {
  return el('div', { class: 'settings-row' }, [
    el('span', { class: 'settings-key', text: key }),
    el('span', { class: 'settings-value', text: value }),
  ]);
}

function flagsEditor(ex) {
  const wrap = el('div', {});
  const chips = el('div', { class: 'flag-chip-row' });
  function refresh() {
    chips.innerHTML = '';
    const active = ex.constraintFlags || [];
    if (active.length === 0) {
      chips.appendChild(el('div', { class: 'flag-empty', text: 'NO FLAGS SET  ·  EXERCISE IS SAFE WITH CURRENT CONSTRAINTS' }));
    } else {
      for (const flagId of active) {
        const known = KNOWN_FLAGS.find((k) => k.id === flagId);
        const label = known ? known.label : flagId.toUpperCase();
        chips.appendChild(el('span', { class: 'flag-chip' }, [
          el('span', { text: '⚑ ' + label }),
          el('button', {
            class: 'flag-chip-x', text: '×',
            onclick: async () => {
              ex.constraintFlags = (ex.constraintFlags || []).filter((f) => f !== flagId);
              await db.put('exercises', { ...ex, updatedAt: new Date().toISOString() });
              refresh();
              toast(`REMOVED FLAG · ${label}`, 'ok');
            },
          }),
        ]));
      }
    }
  }
  refresh();
  wrap.appendChild(chips);

  const addBtn = el('button', { class: 'btn btn-outline', style: 'margin-top: 8px;' }, [
    el('span', { class: 'btn-title', text: '+ ADD FLAG' }),
    el('span', { class: 'btn-sub', text: 'MARK THIS EXERCISE AS CONSTRAINED' }),
  ]);
  addBtn.addEventListener('click', () => {
    const active = new Set(ex.constraintFlags || []);
    const available = KNOWN_FLAGS.filter((f) => !active.has(f.id));
    openPicker('ADD FLAG', available.map((f) => ({ label: f.label, id: f.id })), async (item) => {
      ex.constraintFlags = [...(ex.constraintFlags || []), item.id];
      await db.put('exercises', { ...ex, updatedAt: new Date().toISOString() });
      refresh();
      toast(`ADDED FLAG · ${item.label}`, 'ok');
    });
  });
  wrap.appendChild(addBtn);
  return wrap;
}

function onDeleteExercise(ex, uses) {
  const bodyText = uses.length > 0
    ? `This exercise is in ${uses.length} routine(s). Deleting keeps the routines intact, but exercise slots will show "(deleted)" until you swap. Continue?`
    : 'Permanently delete this exercise from your library. Cannot be undone.';
  confirmModal('DELETE EXERCISE?', bodyText, async () => {
    try { await db.remove('exercises', ex.id); toast(`DELETED · ${ex.name}`, 'ok'); window.location.hash = '#/library'; }
    catch (err) { console.error(err); toast('DELETE FAILED · ' + err.message, 'error'); }
  });
}

async function renderExerciseForm(container, existing) {
  const isEdit = !!existing;
  const model = isEdit ? { ...existing } : {
    id: uid('cu'), name: '', category: 'strength',
    primaryMuscles: [], secondaryMuscles: [], equipment: '', isCustom: true,
    notes: '', substituteIds: [], constraintFlags: [], createdAt: new Date().toISOString(),
  };

  container.appendChild(el('section', { class: 'hero' }, [
    el('div', { class: 'eyebrow' }, [
      el('a', { href: isEdit ? `#/exercise/${model.id}` : '#/library', class: 'crumb', text: isEdit ? '‹ CANCEL' : '‹ LIBRARY' }),
      el('span', { text: '  ·  ' + (isEdit ? 'EDITING' : 'NEW EXERCISE') }),
    ]),
    el('h1', { text: isEdit ? 'EDIT EXERCISE' : 'CREATE EXERCISE' }),
  ]));

  const form = el('div', { class: 'form-stack' });
  form.appendChild(formField('NAME', 'text', 'name', model.name, 'e.g. Cable Row (Neutral Grip)'));
  form.appendChild(formSelect('CATEGORY', 'category', model.category, CATEGORIES.map((c) => ({ value: c, label: c.toUpperCase() }))));
  form.appendChild(formField('EQUIPMENT', 'text', 'equipment', model.equipment, 'e.g. Cable Machine, Dumbbell, Bodyweight'));
  form.appendChild(formField('PRIMARY MUSCLES', 'text', 'primaryMuscles', (model.primaryMuscles || []).join(', '), 'COMMA-SEPARATED'));
  form.appendChild(formField('SECONDARY MUSCLES', 'text', 'secondaryMuscles', (model.secondaryMuscles || []).join(', '), 'COMMA-SEPARATED'));
  form.appendChild(formField('VIDEO LINK (OPTIONAL)', 'url', 'videoUrl', model.videoUrl || '', 'https://... FORM DEMO OR TUTORIAL'));
  form.appendChild(formTextarea('NOTES', 'notes', model.notes, 'Form cues, setup reminders, PT notes...'));
  container.appendChild(section(null, form));

  const saveBtn = el('button', { class: 'btn btn-primary' }, [
    el('span', { class: 'btn-title', text: isEdit ? 'SAVE CHANGES' : 'CREATE EXERCISE' }),
    el('span', { class: 'btn-sub', text: isEdit ? 'UPDATE THIS EXERCISE' : 'ADDS TO YOUR LIBRARY' }),
  ]);
  saveBtn.addEventListener('click', async () => {
    const updated = {
      ...model,
      name: form.querySelector('[name="name"]').value.trim(),
      category: form.querySelector('[name="category"]').value,
      equipment: form.querySelector('[name="equipment"]').value.trim(),
      primaryMuscles: form.querySelector('[name="primaryMuscles"]').value.split(',').map((s) => s.trim()).filter(Boolean),
      secondaryMuscles: form.querySelector('[name="secondaryMuscles"]').value.split(',').map((s) => s.trim()).filter(Boolean),
      videoUrl: form.querySelector('[name="videoUrl"]').value.trim() || null,
      notes: form.querySelector('[name="notes"]').value.trim(),
      updatedAt: new Date().toISOString(),
    };
    if (!updated.name) { toast('NAME REQUIRED', 'error'); return; }
    try { await db.put('exercises', updated); toast(isEdit ? 'SAVED' : `CREATED · ${updated.name}`, 'ok'); window.location.hash = `#/exercise/${updated.id}`; }
    catch (err) { console.error(err); toast('SAVE FAILED · ' + err.message, 'error'); }
  });
  const cancelBtn = el('a', { class: 'btn btn-outline', href: isEdit ? `#/exercise/${model.id}` : '#/library' }, [
    el('span', { class: 'btn-title', text: 'CANCEL' }),
    el('span', { class: 'btn-sub', text: 'DISCARD CHANGES' }),
  ]);
  container.appendChild(section('SAVE', el('div', { class: 'action-stack' }, [saveBtn, cancelBtn])));
}

// ---------- STATS delegates ----------
export async function renderStats(container, params) {
  const { renderStatsPage } = await import('./stats.js?v=13');
  return renderStatsPage(container, params);
}

// ---------- ME ----------
export async function renderMe(container) {
  const [exCount, rtCount, sessCount, bmCount, daCount, goalCount] = await Promise.all([
    db.count('exercises'), db.count('routines'), db.count('sessions'),
    db.count('bodyMeasurements'), db.count('dailyActivity'), db.count('goals'),
  ]);
  const meta = await db.get('meta', 'lastImport');
  const lastImportDate = meta?.value?.importedAt ? new Date(meta.value.importedAt) : null;

  container.appendChild(el('section', { class: 'hero' }, [
    el('div', { class: 'eyebrow', text: 'ME  ·  DATA  ·  SETTINGS' }),
    el('h1', { text: 'YOUR VAULT' }),
    el('p', { class: 'hero-sub', text: 'Everything below lives on this device. Nothing syncs. Back it up regularly.' }),
    el('p', { class: 'hero-meta', text: lastImportDate ? `LAST IMPORT · ${Math.floor((Date.now() - lastImportDate.getTime()) / 86400000)}D AGO` : 'NO IMPORT YET' }),
  ]));

  const links = el('div', { class: 'action-stack' }, [
    navRow('BODY METRICS', 'LOG WEIGHT + MEASUREMENTS', '#/body'),
    navRow('GOALS', 'INCA TRAIL · WEIGHT · PUSH-UPS · CLEARANCE', '#/goals'),
    navRow('SETTINGS', 'UNITS · STRIDE · CONSTRAINTS · BACKUP', '#/settings'),
    navRow('HISTORY', 'ALL PAST SESSIONS', '#/history'),
  ]);
  container.appendChild(section('QUICK ACCESS', links));

  const grid = el('div', { class: 'stat-grid' });
  const cards = [
    { store: 'exercises', label: 'EXERCISES', value: exCount, sub: 'IN LIBRARY', highlight: true },
    { store: 'routines', label: 'ROUTINES', value: rtCount, sub: 'ALL PROGRAMS' },
    { store: 'bodyMeasurements', label: 'MEASUREMENTS', value: bmCount, sub: 'BODY LOG' },
    { store: 'sessions', label: 'SESSIONS', value: sessCount, sub: 'WORKOUTS LOGGED' },
    { store: 'goals', label: 'GOALS', value: goalCount, sub: 'TRACKED' },
    { store: 'dailyActivity', label: 'DAILY ACTIVITY', value: daCount, sub: 'DAYS LOGGED' },
  ];
  for (const c of cards) {
    const card = el('div', { class: 'stat-card' }, [
      el('span', { class: 'stat-label', text: c.label }),
      el('div', {}, [ el('div', { class: 'stat-value', text: c.value }), el('div', { class: 'stat-sub', text: c.sub }) ]),
    ]);
    if (c.highlight) card.setAttribute('data-highlight', '');
    if (c.value > 0) { card.setAttribute('data-tappable', ''); card.addEventListener('click', () => openInspector(c.store, c.label)); }
    grid.appendChild(card);
  }
  container.appendChild(section('DATA STATUS  ·  TAP A CARD TO INSPECT', grid));

  container.appendChild(section('BACKUP & RESTORE', el('div', { class: 'action-stack' }, [
    btnCard('EXPORT BACKUP', 'DOWNLOAD JSON · SAVE TO DRIVE / iCLOUD', 'primary', onExport),
    btnCard('IMPORT BACKUP', 'RESTORE FROM JSON FILE', 'outline', () => document.getElementById('file-input').click()),
  ])));
  container.appendChild(section('ADVANCED', el('div', { class: 'action-stack' }, [
    btnCard('CLEAR ALL DATA', 'WIPE THIS DEVICE · IRREVERSIBLE', 'danger', onClearClick),
    btnCard('RE-IMPORT BUNDLED HEVY DATA', "RESTORE FROM APP'S SEED FILE", 'outline', onReimportClick),
  ])));

  const est = await db.storageEstimate();
  let storageText = 'ESTIMATE UNAVAILABLE';
  if (est) {
    const usedMb = (est.usage / 1024 / 1024).toFixed(2);
    const quotaMb = (est.quota / 1024 / 1024).toFixed(0);
    const pct = ((est.usage / est.quota) * 100).toFixed(2);
    storageText = `${usedMb} MB USED  ·  ${quotaMb} MB AVAILABLE  ·  ${pct}%`;
  }
  container.appendChild(el('section', { class: 'section footer-note' }, [ el('p', { text: `Storage: ${storageText}` }) ]));
}

function navRow(title, sub, href) {
  return el('a', { class: 'nav-row', href }, [
    el('div', { class: 'nav-row-main' }, [
      el('div', { class: 'nav-row-title', text: title }),
      el('div', { class: 'nav-row-sub', text: sub }),
    ]),
    el('div', { class: 'nav-row-arrow', text: '›' }),
  ]);
}
function btnCard(title, sub, variant, onClick) {
  return el('button', { class: `btn btn-${variant}`, onclick: onClick }, [
    el('span', { class: 'btn-title', text: title }),
    el('span', { class: 'btn-sub', text: sub }),
  ]);
}
async function onExport() {
  try { const r = await downloadBackup(); toast(`EXPORTED  ·  ${r.filename}  ·  ${(r.size / 1024).toFixed(1)} KB`, 'ok'); }
  catch (err) { console.error(err); toast('EXPORT FAILED · ' + err.message, 'error'); }
}
function onClearClick() {
  confirmModal('CLEAR ALL DATA?', 'This wipes every exercise, routine, session, measurement, and setting from this device. Export first.', async () => {
    try { await db.clearAll(); toast('DATA CLEARED', 'ok'); refresh(); }
    catch (err) { console.error(err); toast('CLEAR FAILED · ' + err.message, 'error'); }
  });
}
function onReimportClick() {
  confirmModal('RE-IMPORT BUNDLED HEVY DATA?', "Wipes current data and reloads the app's bundled Hevy seed file.", async () => {
    try {
      await db.clearAll();
      const summary = await importBundledHevyBackup();
      toast(`REIMPORTED  ·  ${summary.exercises} EX  ·  ${summary.routines} ROUTINES  ·  ${summary.goals} GOALS`, 'ok', 3500);
      refresh();
    } catch (err) { console.error(err); toast('RE-IMPORT FAILED · ' + err.message, 'error'); }
  });
}
async function refresh() { const m = await import('./app.js?v=13'); m.refresh && m.refresh(); }

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('file-input')?.addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    e.target.value = '';
    try {
      const json = JSON.parse(await file.text());
      const isForgeBackup = json.export_metadata?.app === 'FORGE';
      confirmModal(`RESTORE FROM ${isForgeBackup ? 'FORGE' : 'HEVY'} BACKUP?`, "This wipes current data and replaces it with the file's contents.", async () => {
        try {
          let summary;
          if (isForgeBackup) summary = await restoreFromBackupJson(json);
          else { await db.clearAll(); summary = await importHevyJson(json); }
          const total = Object.values(summary).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
          toast(`RESTORED · ${total} ITEMS`, 'ok', 3500);
          refresh();
        } catch (err) { console.error(err); toast('IMPORT FAILED · ' + err.message, 'error'); }
      });
    } catch (err) { console.error(err); toast('INVALID FILE · ' + err.message, 'error'); }
  });
});

async function openInspector(store, label) {
  const rows = await db.getAll(store);
  document.getElementById('inspector-title').textContent = `${label} · ${rows.length}`;
  const body = document.getElementById('inspector-body');
  body.innerHTML = '';
  if (rows.length === 0) { body.innerHTML = `<div class="inspector-empty">EMPTY</div>`; }
  else {
    const renderer = INSPECTOR_RENDERERS[store] || ((r) => `<div class="inspector-item-main">${esc(r.id || r.date || r.key || '')}</div>`);
    const sorted = INSPECTOR_SORTERS[store] ? [...rows].sort(INSPECTOR_SORTERS[store]) : rows;
    for (const row of sorted) { const div = document.createElement('div'); div.className = 'inspector-item'; div.innerHTML = renderer(row); body.appendChild(div); }
  }
  document.getElementById('inspector-scrim').hidden = false;
}
const INSPECTOR_RENDERERS = {
  exercises: (r) => `<div class="inspector-item-main"><span class="inspector-category cat-${r.category || 'strength'}">${(r.category || 'STR').toUpperCase().slice(0, 4)}</span>${esc(r.name)}${r.isCustom ? ' <span class="inspector-item-meta">· CUSTOM</span>' : ''}</div><div class="inspector-item-meta">${esc(r.equipment || '')}</div>`,
  routines: (r) => `<div class="inspector-item-main">${esc(r.name)}${r.folderName ? ` <span class="inspector-item-meta">· ${esc(r.folderName)}</span>` : ''}</div><div class="inspector-item-meta">${(r.exercises || []).length} EX</div>`,
  bodyMeasurements: (r) => `<div class="inspector-item-main">${esc(r.date)}</div><div class="inspector-item-meta">${r.weight != null ? r.weight + ' LB' : '—'}</div>`,
  sessions: (r) => `<div class="inspector-item-main">${esc(r.routineName || '(session)')}</div><div class="inspector-item-meta">${(r.completedAt || r.startedAt || '').slice(0, 10)}${r.isActive ? ' · ACTIVE' : ''}</div>`,
  goals: (r) => `<div class="inspector-item-main">${esc(r.title)}${r.type ? ` <span class="inspector-item-meta">· ${esc(r.type.toUpperCase())}</span>` : ''}</div><div class="inspector-item-meta">${r.targetDate ? esc(r.targetDate) : (r.targetValue != null ? r.targetValue : '')}</div>`,
  dailyActivity: (r) => `<div class="inspector-item-main">${esc(r.date)}</div><div class="inspector-item-meta">${r.steps != null ? r.steps.toLocaleString() + ' STEPS' : '—'}</div>`,
};
const INSPECTOR_SORTERS = {
  bodyMeasurements: (a, b) => (b.date || '').localeCompare(a.date || ''),
  dailyActivity: (a, b) => (b.date || '').localeCompare(a.date || ''),
  exercises: (a, b) => (a.name || '').localeCompare(b.name || ''),
  routines: (a, b) => (a.name || '').localeCompare(b.name || ''),
  goals: (a, b) => (a.targetDate || '').localeCompare(b.targetDate || ''),
  sessions: (a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''),
};
