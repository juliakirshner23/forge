// FORGE screens: home, plan, routine detail, library, exercise, me
import * as db from './db.js?v=31';
import { downloadBackup, restoreFromBackupJson } from './export.js?v=31';
import { importBundledHevyBackup, importHevyJson } from './import.js?v=31';
import {
  el, section, notFound, formField, formSelect, formTextarea,
  catBadge, focusTagEl, progressBar, routineTags, localDay, todayIso,
  DAY_ORDER, DAY_LABELS, DAY_FULL, CATEGORIES,
  currentDayKey, daysUntil, formatDuration, esc, uid,
  toast, confirmModal, openPicker, getActiveSession,
} from './ui.js?v=31';
import { exerciseSuggestion } from './progression.js?v=31';
import { TRAIL, getStatus, fmtMi, fmtFt, KM_PER_MI, WORKOUT_POINTS, SKIP_PENALTY } from './trail.js?v=31';
import { icon } from './icons.js?v=31';
import { CAT_LABEL, routinesOn, weekDates, scheduleSummary, guideFor, targetsForExercise, phaseById, dayKeyOfIso } from './program.js?v=31';

function suggestionNoteEl(sg) {
  return el('div', { class: `ex-suggest ex-suggest-${sg.kind}` }, [
    el('span', { class: 'ex-suggest-kind', text: sg.label }),
    el('span', { class: 'ex-suggest-text', text: sg.text }),
  ]);
}

// ---------- HOME ----------
export async function renderHome(container) {
  const today = todayIso();
  const [routines, sessions, exercises] = await Promise.all([db.getAll('routines'), db.getAll('sessions'), db.getAll('exercises')]);
  const exById = new Map(exercises.map((e) => [e.id, e]));
  const todaysRoutines = routinesOn(routines, today);
  const activeSession = sessions.find((s) => s.isActive === true) || null;
  const completedSessions = sessions.filter((s) => !s.isActive && s.completedAt);

  container.appendChild(el('section', { class: 'hero' }, [
    el('div', { class: 'eyebrow', text: new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase() }),
    el('h1', { text: 'TODAY' }),
  ]));

  if (activeSession) {
    container.appendChild(section('IN PROGRESS',
      el('a', { class: 'today-card', href: `#/session/${activeSession.id}`, style: 'border-color: var(--green);' }, [
        el('div', { class: 'today-label', style: 'color: var(--green);', text: 'RESUME WORKOUT' }),
        el('div', { class: 'today-name', text: activeSession.routineName || '(session)' }),
        el('div', { class: 'today-meta', text: activeSession.logDate ? `LOGGING FOR ${activeSession.logDate}` : `STARTED ${new Date(activeSession.startedAt).toLocaleTimeString()}` }),
        el('div', { class: 'today-cta', style: 'color: var(--green);', text: 'RESUME →' }),
      ])
    ));
  }

  const trail = await getStatus();
  container.appendChild(section('INCA TRAIL', trailCard(trail)));

  let todayCard;
  if (todaysRoutines.length === 0) {
    todayCard = el('a', { class: 'today-card today-rest', href: '#/plan' }, [
      el('div', { class: 'today-label', text: 'NOTHING PLANNED' }),
      el('div', { class: 'today-sub', text: 'Add a routine to today in Plan' }),
    ]);
  } else {
    todayCard = el('div', { class: 'today-stack' }, todaysRoutines.map((r) => el('div', { class: 'today-card' }, [
      el('a', { class: 'today-link', href: `#/routine/${r.id}` }, [
        el('div', { class: 'today-name', text: r.name }),
        el('div', { class: 'tag-row' }, routineTags(r, exById).map(focusTagEl)),
        el('div', { class: 'today-meta', text: `${(r.exercises || []).length} EXERCISES  ·  TAP TO VIEW` }),
      ]),
      ...todayStakes(trail),
      el('button', { class: 'btn btn-primary today-start', onclick: () => startRoutineNow(r) }, [ el('span', { class: 'btn-title', text: 'START WORKOUT' }) ]),
    ])));
  }
  container.appendChild(section("TODAY'S WORKOUT", todayCard));
  container.appendChild(section('THIS WEEK', weeklyAdherence(completedSessions, routines)));
  container.appendChild(await caloriesCardSection());
  container.appendChild(await stepsCardSection());
}

async function startRoutineNow(routine) {
  const activeSession = await getActiveSession();
  return onStartWorkoutClick(routine, activeSession);
}

// ---------- TRAIL (v0.9.0) ----------
function todayStakes(trail) {
  if (trail.pausedToday) return [el('div', { class: 'today-stake', text: 'TRAIL PAUSED · NO PENALTIES' })];
  if (trail.doneToday) return [el('div', { class: 'today-stake today-stake-earn', text: '✓ DONE TODAY · TRAIL CREDIT EARNED' })];
  const pts = Math.round(WORKOUT_POINTS * trail.multiplier);
  return [
    el('div', { class: 'today-stake today-stake-earn', text: `EARNS +${pts} PTS · PLUS TRAIL MILES AND CLIMB FROM WHAT YOU LOG` }),
    el('div', { class: 'today-stake today-stake-skip', text: `SKIP IT: −${SKIP_PENALTY} PTS AND STREAK RESETS · DISTANCE IS NEVER LOST` }),
  ];
}

const MAP_W = 260, MAP_H = 110;
const mapX = (km) => 6 + (km / TRAIL.totalKm) * (MAP_W - 14);
const mapY = (m) => 92 - (m - 2400) * 0.04;
function profileAt(km) {
  const pts = TRAIL.profile;
  if (km <= 0) return pts[0].m;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (km <= b.km) return a.m + (b.m - a.m) * ((km - a.km) / (b.km - a.km));
  }
  return pts[pts.length - 1].m;
}
export function trailMapSvg(distKm) {
  const pts = TRAIL.profile;
  const k = Math.max(0, Math.min(TRAIL.totalKm, distKm));
  const line = pts.map((p) => `${mapX(p.km).toFixed(1)} ${mapY(p.m).toFixed(1)}`);
  const area = `M${line.join(' L')} L${mapX(TRAIL.totalKm)} 100 L${mapX(0)} 100 Z`;
  const doneArr = pts.filter((p) => p.km < k).map((p) => `${mapX(p.km).toFixed(1)} ${mapY(p.m).toFixed(1)}`);
  const mx = mapX(k), my = mapY(profileAt(k));
  doneArr.push(`${mx.toFixed(1)} ${my.toFixed(1)}`);
  const peaks = pts.filter((p) => p.peak).map((p) => `<circle cx="${mapX(p.km).toFixed(1)}" cy="${mapY(p.m).toFixed(1)}" r="3" class="tm-peak"/>`).join('');
  return `<svg class="trail-map" viewBox="0 0 ${MAP_W} ${MAP_H}" width="100%" role="img" aria-label="Inca Trail elevation profile with your position">
    <path d="${area}" class="tm-area"/>
    <path d="M${line.join(' L')}" class="tm-todo"/>
    ${doneArr.length > 1 ? `<path d="M${doneArr.join(' L')}" class="tm-done"/>` : ''}
    ${peaks}
    <circle cx="${mapX(19).toFixed(1)}" cy="${mapY(4215).toFixed(1)}" r="3.5" class="tm-high"/>
    <circle cx="${mapX(44).toFixed(1)}" cy="${mapY(2430).toFixed(1)}" r="3.5" class="tm-end"/>
    <circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="5.5" class="tm-you"/>
    <text x="${(mapX(19) - 4).toFixed(1)}" y="14" text-anchor="end" class="tm-label tm-label-high">4,215 m</text>
    <text x="${(mapX(24) + 4).toFixed(1)}" y="22" class="tm-label">3,950 m</text>
    <text x="6" y="108" class="tm-label">START</text>
    <text x="${MAP_W - 4}" y="108" text-anchor="end" class="tm-label">MACHU PICCHU</text>
  </svg>`;
}

function trailCard(t) {
  const leftMi = Math.max(0, TRAIL.totalKm - t.distKm) / KM_PER_MI;
  const map = el('div', {});
  map.innerHTML = trailMapSvg(t.distKm);
  const children = [
    el('div', { class: 'trail-card-head' }, [
      el('span', { class: 'trail-card-title', text: t.complete ? '◆ TRAIL COMPLETE' : 'YOUR POSITION' }),
      el('span', { class: 'trail-card-open', text: 'OPEN ›' }),
    ]),
    map,
    el('div', { class: 'trail-card-nums' }, [
      el('span', {}, [
        el('b', { text: fmtMi(t.distKm) }), document.createTextNode(' MI  ·  '),
        el('span', { class: 'trail-muted', text: `${leftMi.toFixed(1)} TO GO` }),
      ]),
      el('span', {}, [ el('b', { text: fmtFt(t.climbM) }), document.createTextNode(' FT') ]),
    ]),
    el('div', { class: 'trail-muted trail-card-streak' }, [
      t.pausedToday
        ? document.createTextNode('⏸ PAUSED · PROGRESS HELD')
        : document.createTextNode(`${t.streak}-DAY STREAK  ·  ${t.multiplier.toFixed(2).replace(/0$/, '')}× POINTS`),
    ]),
  ];
  return el('a', { class: 'trail-card', href: '#/trail' }, children);
}

export async function renderTrail(container) {
  const t = await getStatus();
  container.appendChild(el('section', { class: 'hero' }, [
    el('div', { class: 'eyebrow' }, [
      el('a', { href: '#/home', class: 'crumb', text: '‹ TODAY' }),
      el('span', { text: '  ·  CLASSIC 4-DAY ROUTE' }),
    ]),
    el('h1', { text: TRAIL.name }),
    t.pausedToday ? el('p', { class: 'hero-sub', text: 'PAUSED · NO PENALTIES · EVERYTHING HELD. RESUME IN ME (GEAR ICON).' }) : null,
  ]));

  const mapBox = el('div', { class: 'trail-card' });
  mapBox.innerHTML = trailMapSvg(t.distKm);
  container.appendChild(section('YOUR POSITION', mapBox));

  const totalMi = TRAIL.totalKm / KM_PER_MI;
  const totalFt = Math.round(TRAIL.gainM * 3.28084);
  const distPct = Math.min(100, (t.distKm / TRAIL.totalKm) * 100);
  const climbPct = Math.min(100, (t.climbM / TRAIL.gainM) * 100);
  const leftMi = Math.max(0, totalMi - t.distKm / KM_PER_MI);
  const leftFt = Math.max(0, totalFt - Math.round(t.climbM * 3.28084));
  const progress = el('div', { class: 'trail-progress' }, [
    el('div', { class: 'trail-row' }, [ el('span', { class: 'trail-muted', text: 'DISTANCE' }), el('span', {}, [el('b', { text: fmtMi(t.distKm) }), document.createTextNode(` / ${totalMi.toFixed(1)} MI`)]) ]),
    el('div', { class: 'trail-bar' }, [ el('div', { class: 'trail-bar-fill trail-bar-dist', style: `width:${distPct}%` }) ]),
    el('div', { class: 'trail-muted trail-sub', text: `${leftMi.toFixed(1)} MI TO GO` }),
    el('div', { class: 'trail-row' }, [ el('span', { class: 'trail-muted', text: 'CLIMB' }), el('span', {}, [el('b', { text: fmtFt(t.climbM) }), document.createTextNode(` / ${totalFt.toLocaleString()} FT`)]) ]),
    el('div', { class: 'trail-bar' }, [ el('div', { class: 'trail-bar-fill trail-bar-climb', style: `width:${climbPct}%` }) ]),
    el('div', { class: 'trail-muted trail-sub', text: `${leftFt.toLocaleString()} FT TO CLIMB  ·  HIGH POINT 4,215 M` }),
    el('div', { class: 'trail-muted trail-sub', text: 'FINISHING NEEDS BOTH THE DISTANCE AND THE CLIMB.' }),
  ]);
  container.appendChild(section('PROGRESS', progress));

  container.appendChild(section('POINTS', el('div', { class: 'trail-progress' }, [
    el('div', { class: 'trail-row' }, [ el('span', { class: 'trail-muted', text: 'TOTAL' }), el('b', { text: String(t.points) }) ]),
    el('div', { class: 'trail-row' }, [ el('span', { class: 'trail-muted', text: 'STREAK' }), el('span', { text: `${t.streak} DAYS  ·  ${t.multiplier.toFixed(2)}×` }) ]),
  ])));

  const grid = el('div', { class: 'badge-grid' });
  for (const b of TRAIL.badges) {
    const earned = t.badges[b.id];
    const tile = el('div', { class: 'badge-tile' + (earned ? ' badge-earned' : '') });
    tile.innerHTML = icon(b.icon, 22);
    tile.appendChild(el('div', { class: 'badge-name', text: b.name }));
    tile.appendChild(el('div', { class: 'badge-meta', text: earned ? earned : (b.complete ? 'FINISH' : `${(b.km / KM_PER_MI).toFixed(1)} MI`) }));
    grid.appendChild(tile);
  }
  container.appendChild(section('BADGES', grid));

  container.appendChild(section('HOW CREDIT WORKS', el('div', { class: 'note-block', text:
    'Treadmill: speed × time, climb from incline. Elliptical and other cardio: climb from your heart rate calibration. ' +
    'Stairmaster: steps × step height. Strength: 1/4 credit from your heart rate. Steps never move you on the trail. ' +
    'Points: workouts (more for a streak), +10 per meal logged, a bonus at 12,500 steps. Skipping a scheduled day costs 20 points. ' +
    'Calibration, step height, and pause live in ME (gear icon, top right).' })));
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

async function caloriesCardSection() {
  const { exerciseKcalForDate, foodKcalForDate, latestBodyWeightLb } = await import('./food.js?v=31');
  const today = todayIso();
  const exercises = await db.getAll('exercises');
  const exIndex = new Map(exercises.map((e) => [e.id, e]));
  const [foodKcal, ex] = await Promise.all([foodKcalForDate(today), latestBodyWeightLb().then((lb) => exerciseKcalForDate(today, exIndex, lb))]);
  const card = el('a', { class: 'calories-card calories-card-compact', href: '#/food' }, [
    el('div', { class: 'calories-row' }, [
      el('div', { class: 'calories-col' }, [
        el('span', { class: 'calories-label', text: 'FOOD' }),
        el('span', { class: 'calories-value', text: String(foodKcal) }),
        el('span', { class: 'calories-unit', text: 'KCAL' }),
      ]),
      el('div', { class: 'calories-col' }, [
        el('span', { class: 'calories-label', text: 'WORKOUT' }),
        el('span', { class: 'calories-value calories-value-burn', text: String(ex.kcal) }),
        el('span', { class: 'calories-unit', text: ex.isOverride ? 'KCAL · MANUAL' : 'KCAL' }),
      ]),
    ]),
  ]);
  return section('CALORIES', card);
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
    if (!v || v < 0) { const { toast } = await import('./ui.js?v=31'); toast('ENTER A STEP COUNT', 'error'); return; }
    const dist = strideIn ? Math.round((v * strideIn) / 63360 * 100) / 100 : null;
    await db.put('dailyActivity', {
      date: todayIso, steps: v, distanceMi: dist,
      strideLengthIn: strideIn, updatedAt: new Date().toISOString(),
    });
    const { toast } = await import('./ui.js?v=31');
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
  const today = todayIso();
  const doneDays = new Set(completedSessions.map((s) => localDay(s.completedAt)));
  const wrap = el('div', { class: 'week-dots' });
  for (const d of weekDates(today)) {
    const scheduled = routinesOn(routines, d).length > 0;
    const done = doneDays.has(d);
    const isFuture = d > today;
    let cls = 'week-dot';
    if (done) cls += ' week-dot-done';
    else if (isFuture && scheduled) cls += ' week-dot-scheduled';
    else if (!isFuture && scheduled && d < today) cls += ' week-dot-missed';
    else if (scheduled) cls += ' week-dot-scheduled';
    else cls += ' week-dot-rest';
    if (d === today) cls += ' week-dot-today';
    wrap.appendChild(el('div', { class: cls }, [
      el('span', { class: 'week-dot-day', text: dayKeyOfIso(d).toUpperCase() }),
      el('span', { class: 'week-dot-mark', text: done ? '✓' : scheduled ? (d < today ? '×' : '◇') : '·' }),
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
export async function renderPlan(container, params) {
  const m = await import('./plan.js?v=31');
  return m.renderPlan(container, params);
}
export async function renderBlock(container, params) {
  const m = await import('./plan.js?v=31');
  return m.renderBlock(container, params);
}

// ---------- ROUTINE (view; edit lives in routine-editor.js) ----------
export async function renderRoutine(container, params) {
  const [routineId, action] = params;
  if (routineId === 'new') {
    const { renderRoutineEditor } = await import('./routine-editor.js?v=31');
    return renderRoutineEditor(container, null, action || null);
  }
  const routine = routineId ? await db.get('routines', routineId) : null;
  if (!routine) { container.appendChild(notFound('ROUTINE NOT FOUND', '#/plan', 'PLAN')); return; }
  if (action === 'edit') {
    const { renderRoutineEditor } = await import('./routine-editor.js?v=31');
    return renderRoutineEditor(container, routine);
  }
  return renderRoutineDetail(container, routine);
}

async function renderRoutineDetail(container, routine) {
  const allExercises = await db.getAll('exercises');
  const exById = new Map(allExercises.map((e) => [e.id, e]));
  const activeSession = await getActiveSession();
  const ph = routine.phaseId ? phaseById(routine.phaseId) : null;
  const tags = routineTags(routine, exById);

  container.appendChild(el('section', { class: 'hero' }, [
    el('div', { class: 'eyebrow' }, [
      el('a', { href: ph ? `#/plan/${ph.id}` : '#/plan', class: 'crumb', text: '‹ PLAN' }),
      el('span', { text: '  ·  ' + (ph ? ph.name : 'ROUTINE') }),
    ]),
    el('h1', { text: routine.name }),
    el('p', { class: 'hero-meta', text: `${(routine.exercises || []).length} EXERCISES  ·  ${scheduleSummary(routine)}` }),
    tags.length ? el('div', { class: 'tag-row', style: 'margin-top: 12px;' }, tags.map(focusTagEl)) : null,
  ]));

  const exercises = routine.exercises || [];
  if (exercises.length === 0) {
    container.appendChild(section('EXERCISES', el('div', { class: 'empty-note', text: 'NO EXERCISES IN THIS ROUTINE' })));
  } else {
    const list = el('div', { class: 'exercise-list' });
    exercises.forEach((ex, idx) => {
      const libEx = exById.get(ex.exerciseId);
      const row = exerciseRow(ex, idx, libEx?.category || 'strength', libEx, exById);
      list.appendChild(row);
      exerciseSuggestion(ex.exerciseId).then((sg) => {
        if (sg) row.querySelector('.exercise-main')?.appendChild(suggestionNoteEl(sg));
      });
    });
    container.appendChild(section(`EXERCISES  ·  ${exercises.length}  ·  TAP FOR INSTRUCTIONS`, list));
  }

  const isActiveForThis = activeSession && activeSession.routineId === routine.id;
  const isActiveOther = activeSession && activeSession.routineId !== routine.id;
  const startBtn = el('button', { class: 'btn btn-primary' }, [
    el('span', { class: 'btn-title', text: isActiveForThis ? 'RESUME WORKOUT' : 'START WORKOUT' }),
    el('span', { class: 'btn-sub', text: isActiveForThis ? 'CONTINUE ACTIVE SESSION' : isActiveOther ? '⚠ ANOTHER SESSION IS ACTIVE' : 'BEGIN LOGGING SETS' }),
  ]);
  startBtn.addEventListener('click', () => onStartWorkoutClick(routine, activeSession));
  const schedBtn = el('button', { class: 'btn btn-outline' }, [
    el('span', { class: 'btn-title', text: 'ADD TO DAY' }),
    el('span', { class: 'btn-sub', text: 'REPEAT ON WEEKDAYS OR PICK DATES' }),
  ]);
  schedBtn.addEventListener('click', async () => { const m = await import('./plan.js?v=31'); m.openScheduleSheet(routine); });
  const editBtn = el('a', { class: 'btn btn-outline', href: `#/routine/${routine.id}/edit` }, [
    el('span', { class: 'btn-title', text: 'EDIT ROUTINE' }),
    el('span', { class: 'btn-sub', text: 'CHANGE EXERCISES, SETS, NAME, PHASE' }),
  ]);
  container.appendChild(section('ACTIONS', el('div', { class: 'action-stack' }, [startBtn, schedBtn, editBtn])));
}

async function onStartWorkoutClick(routine, activeSession) {
  const { startSession } = await import('./workout.js?v=31');
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

function exerciseRow(ex, idx, category, libEx, exById) {
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
  if (ex.notes) setsSummary = ex.notes.toUpperCase();
  if (ex.restBetweenSets) setsSummary += `  ·  REST ${ex.restBetweenSets}S`;
  const alts = (ex.substituteIds || []).map((id) => exById?.get(id)?.name).filter(Boolean);
  const constraintFlag = libEx?.constraintFlags?.length > 0;
  return el(libEx ? 'a' : 'div', { class: 'exercise-row' + (libEx ? ' exercise-row-link' : ''), href: libEx ? `#/exercise/${libEx.id}` : null }, [
    el('div', { class: 'exercise-num', text: idx + 1 }),
    catBadge(libEx || category),
    el('div', { class: 'exercise-main' }, [
      el('div', { class: 'exercise-name', text: ex.exerciseName || libEx?.name || '(deleted)' }),
      el('div', { class: 'exercise-meta', text: setsSummary }),
      alts.length ? el('div', { class: 'exercise-alts', text: `Alternatives: ${alts.join(' · ')}` }) : null,
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
  const catChips = [{ id: 'all', label: 'ALL' }, ...CATEGORIES.map((c) => ({ id: c, label: CAT_LABEL[c] }))];
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

  container.appendChild(section('ADD', el('div', { class: 'action-stack' }, [
    el('button', { class: 'btn btn-primary', onclick: async () => {
      const { openExercisePicker } = await import('./exercise-picker.js?v=31');
      openExercisePicker('ADD FROM CATALOG', (ex) => { window.location.hash = `#/exercise/${ex.id}`; }, { startTab: 'catalog' });
    } }, [
      el('span', { class: 'btn-title', text: '+ ADD FROM CATALOG' }),
      el('span', { class: 'btn-sub', text: '876 EXERCISES TO CHOOSE FROM' }),
    ]),
    el('a', { class: 'btn btn-outline', href: '#/exercise/new' }, [
      el('span', { class: 'btn-title', text: '+ CREATE CUSTOM EXERCISE' }),
      el('span', { class: 'btn-sub', text: 'MAKES A NEW EXERCISE YOU CAN USE IN ROUTINES' }),
    ]),
  ])));

  function updateList() {
    let filtered = allExercises;
    if (categoryFilter !== 'all') filtered = filtered.filter((e) => e.category === categoryFilter);
    if (searchQuery) filtered = filtered.filter((e) => (e.name || '').toLowerCase().includes(searchQuery));
    if (ptSafeOnly) filtered = filtered.filter((e) => !(e.constraintFlags && e.constraintFlags.length > 0));
    filtered = [...filtered].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    listCounter.textContent = `SHOWING ${filtered.length} OF ${allExercises.length}  ·  By category, A to Z`;
    list.innerHTML = '';
    if (filtered.length === 0) { list.appendChild(el('div', { class: 'empty-note', text: 'NO EXERCISES MATCH THESE FILTERS' })); return; }
    const groups = [...CATEGORIES, 'other'];
    for (const g of groups) {
      const inGroup = filtered.filter((e) => (CATEGORIES.includes(e.category) ? e.category : 'other') === g);
      if (inGroup.length === 0) continue;
      list.appendChild(el('div', { class: 'library-group-head' }, [catBadge(g), el('span', { text: `${inGroup.length} EXERCISE${inGroup.length === 1 ? '' : 'S'}` })]));
      for (const ex of inGroup) list.appendChild(libraryRow(ex, usage.get(ex.id) || 0));
    }
  }
  updateList();
}

function libraryRow(ex, useCount) {
  const flagged = ex.constraintFlags && ex.constraintFlags.length > 0;
  return el('a', { class: 'exercise-row exercise-row-link', href: `#/exercise/${ex.id}` }, [
    catBadge(ex),
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
  const [idOrNew, action, sid, sidx] = params;
  if (idOrNew === 'new') return renderExerciseForm(container, null);
  const exercise = await db.get('exercises', idOrNew);
  if (!exercise) { container.appendChild(notFound('EXERCISE NOT FOUND', '#/library', 'LIBRARY')); return; }
  if (action === 'edit') return renderExerciseForm(container, exercise);
  let ctx = null;
  if (action === 'session' && sid) {
    const ses = await db.get('sessions', sid);
    if (ses && ses.isActive) ctx = { session: ses, idx: Number(sidx) || 0 };
  }
  return renderExerciseDetail(container, exercise, ctx);
}

async function useInWorkout(ctx, exId) {
  const { swapSessionExercise } = await import('./workout.js?v=31');
  await swapSessionExercise(ctx.session.id, ctx.idx, exId);
  window.location.hash = `#/session/${ctx.session.id}`;
}

// Full-screen photo viewer: tap a photo to enlarge, tap Start/Finish to flip, tap outside or × to close.
function openPhotoViewer(imgs, start, name) {
  let i = start;
  const img = el('img', { class: 'pv-img', alt: name });
  const label = el('div', { class: 'pv-label' });
  const tabs = el('div', { class: 'pv-tabs' }, imgs.map((_, k) =>
    el('button', { class: 'pv-tab', text: k === 0 ? 'START' : 'FINISH', onclick: (e) => { e.stopPropagation(); show(k); } })));
  function show(k) {
    i = k; img.src = imgs[k];
    label.textContent = `${name} · ${k === 0 ? 'start' : 'finish'}`;
    [...tabs.children].forEach((b, n) => b.classList.toggle('on', n === k));
  }
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') show((i + 1) % imgs.length); };
  let x0 = null;
  const ov = el('div', { class: 'photo-viewer', 'data-keep-case': '', onclick: close }, [
    el('button', { class: 'pv-close', text: '×', 'aria-label': 'Close', onclick: close }),
    el('div', { class: 'pv-frame', onclick: (e) => { e.stopPropagation(); if (imgs.length > 1) show((i + 1) % imgs.length); } }, [img]),
    label, imgs.length > 1 ? tabs : null,
  ]);
  ov.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  ov.addEventListener('touchend', (e) => { if (x0 == null || imgs.length < 2) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) show((i + 1) % imgs.length); x0 = null; });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(ov);
  show(i);
}

async function renderExerciseDetail(container, ex, ctx = null) {
  const routines = await db.getAll('routines');
  const uses = routines.filter((r) => (r.exercises || []).some((e) => e.exerciseId === ex.id));

  container.appendChild(el('section', { class: 'hero' }, [
    el('div', { class: 'eyebrow' }, [
      ctx
        ? el('a', { href: `#/session/${ctx.session.id}`, class: 'crumb', text: '‹ BACK TO WORKOUT' })
        : el('a', { href: '#/library', class: 'crumb', text: '‹ BACK', onclick: (e) => { if (history.length > 1) { e.preventDefault(); history.back(); } } }),
      el('span', { text: `  ·  ${CAT_LABEL[ex.category] || 'OTHER'}` }),
      uses.length > 0 ? el('span', { text: `  ·  IN ${uses.length} ROUTINE${uses.length === 1 ? '' : 'S'}` }) : null,
    ]),
    el('h1', { text: ex.name }),
    ex.equipment ? el('p', { class: 'hero-meta', text: ex.equipment.toUpperCase() }) : null,
  ]));

  container.appendChild(el('div', { class: 'tag-row', style: 'margin: 0 20px 20px;' }, [
    el('span', { class: 'tag tag-neutral', text: ex.isCustom ? 'CUSTOM' : ex.source === 'catalog' ? 'FROM CATALOG' : 'FROM HEVY' }),
    (ex.constraintFlags && ex.constraintFlags.length > 0)
      ? el('span', { class: 'tag tag-flag', text: '⚑ FLAGGED' })
      : el('span', { class: 'tag tag-safe', text: '◉ PT SAFE' }),
  ]));

  if (ctx) {
    const cur = ctx.session.exercises?.[ctx.idx];
    if (cur && cur.exerciseId !== ex.id) {
      container.appendChild(section(`IN YOUR WORKOUT: ${(cur.exerciseName || '').toUpperCase()}`, el('div', { class: 'action-stack' }, [
        el('button', { class: 'btn btn-primary', onclick: () => useInWorkout(ctx, ex.id) }, [
          el('span', { class: 'btn-title', text: 'USE THIS INSTEAD' }),
          el('span', { class: 'btn-sub', text: 'SWAPS IT IN FOR THIS WORKOUT AND TAKES YOU BACK TO LOG SETS' }),
        ]),
      ])));
    }
  }

  const guide = await guideFor(ex);
  if (guide && guide.img && guide.img.length) {
    container.appendChild(section('HOW IT LOOKS', el('div', {}, [
      el('div', { class: 'guide-photos' }, guide.img.map((src, i) =>
        el('figure', { class: 'guide-photo' }, [
          el('img', { src, alt: `${ex.name} ${i === 0 ? 'start' : 'finish'} position`, loading: 'lazy', onclick: () => openPhotoViewer(guide.img, i, ex.name) }),
          el('figcaption', { text: i === 0 ? 'START' : 'FINISH' }),
        ]))),
      el('p', { class: 'guide-hint', text: 'TAP A PHOTO TO ENLARGE' }),
    ])));
  }
  const steps = (guide && guide.ins && guide.ins.length) ? guide.ins : (ex.instructions || []);
  if (steps.length) container.appendChild(section('HOW TO DO IT', el('ol', { class: 'howto-list' }, steps.map((t) => el('li', { text: t })))));
  if (!guide || !guide.img || !guide.img.length) {
    container.appendChild(el('div', { class: 'guide-nophoto', text: 'NO PHOTO IN THE EXERCISE DATABASE FOR THIS ONE' }));
  }
  const targets = await targetsForExercise(ex.id);
  if (targets.length) {
    container.appendChild(section('YOUR TARGET', el('div', { class: 'settings-list' }, targets.map((t) =>
      metaRow(t.phase, t.target + (t.note ? `  ·  ${t.note.toUpperCase()}` : ''))))));
  }
  const allEx = await db.getAll('exercises');
  const alts = (ex.substituteIds || []).map((id) => allEx.find((e) => e.id === id)).filter(Boolean);
  if (alts.length) {
    container.appendChild(section('MACHINE TAKEN? ALTERNATIVES', el('div', {}, alts.map((a) =>
      el('div', { class: 'alt-row' }, [
        el('a', { class: 'nav-row alt-row-main', href: ctx ? `#/exercise/${a.id}/session/${ctx.session.id}/${ctx.idx}` : `#/exercise/${a.id}` }, [
          el('div', { class: 'nav-row-main' }, [ el('div', { class: 'nav-row-title', text: a.name }), el('div', { class: 'nav-row-sub', text: (a.equipment || 'BODYWEIGHT').toUpperCase() + '  ·  TAP FOR INSTRUCTIONS' }) ]),
          el('div', { class: 'nav-row-arrow', text: '›' }),
        ]),
        ctx ? el('button', { class: 'btn-mini alt-use', text: 'USE', onclick: () => useInWorkout(ctx, a.id) }) : null,
      ])))));
  }

  const metaCard = el('div', { class: 'settings-list' });
  metaCard.appendChild(metaRow('CATEGORY', CAT_LABEL[ex.category] || 'OTHER'));
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
    id: uid('cu'), name: '', category: 'push',
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
  form.appendChild(formSelect('CATEGORY', 'category', CATEGORIES.includes(model.category) ? model.category : 'push', CATEGORIES.map((c) => ({ value: c, label: CAT_LABEL[c] }))));
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
    const cat = form.querySelector('[name="category"]').value;
    const updated = {
      ...model,
      name: form.querySelector('[name="name"]').value.trim(),
      category: cat,
      focus: cat,
      focusEditedByUser: true,
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
  const { renderStatsPage } = await import('./stats.js?v=31');
  return renderStatsPage(container, params);
}

// ---------- ME ----------
export async function renderMe(container) {
  const [exCount, rtCount, sessCount, bmCount, daCount, goalCount] = await Promise.all([
    db.count('exercises'), db.count('routines'), db.count('sessions'),
    db.count('bodyMeasurements'), db.count('dailyActivity'), db.count('goals'),
  ]);

  // Settings (profile, units, targets, trail, training, app), then data.
  const { renderSettings } = await import('./settings.js?v=31');
  await renderSettings(container);

  const grid = el('div', { class: 'stat-grid' });
  const cards = [
    { store: 'exercises', label: 'EXERCISES', value: exCount, sub: 'IN LIBRARY', highlight: true },
    { store: 'routines', label: 'ROUTINES', value: rtCount, sub: 'IN YOUR PLAN' },
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
  container.appendChild(section('DATA  ·  STORED ON THIS DEVICE ONLY  ·  TAP A CARD TO INSPECT', grid));

  container.appendChild(section('BACKUP & RESTORE', el('div', { class: 'action-stack' }, [
    btnCard('EXPORT BACKUP', 'DOWNLOAD JSON · SAVE TO DRIVE / iCLOUD', 'primary', onExport),
    btnCard('IMPORT BACKUP', 'RESTORE FROM JSON FILE', 'outline', () => document.getElementById('file-input').click()),
  ])));
  container.appendChild(section('ADVANCED', el('div', { class: 'action-stack' }, [
    btnCard('CLEAR ALL DATA', 'WIPE THIS DEVICE · IRREVERSIBLE', 'danger', onClearClick),
  ])));

  const est = await db.storageEstimate();
  let storageText = 'ESTIMATE UNAVAILABLE';
  if (est) {
    const usedMb = (est.usage / 1024 / 1024).toFixed(2);
    const quotaMb = (est.quota / 1024 / 1024).toFixed(0);
    const pct = ((est.usage / est.quota) * 100).toFixed(2);
    storageText = `${usedMb} MB USED  ·  ${quotaMb} MB AVAILABLE  ·  ${pct}%`;
  }
  container.appendChild(el('section', { class: 'section footer-note' }, [ el('p', { text: `FORGE v1.0.6  ·  Storage: ${storageText}` }) ]));
}

// ---------- PROGRESS: history · charts · body · goals ----------
const PROGRESS_SEGS = [['history', 'HISTORY'], ['charts', 'CHARTS'], ['body', 'BODY'], ['goals', 'GOALS']];
export async function renderProgress(container, params) {
  const seg = PROGRESS_SEGS.some(([k]) => k === (params && params[0])) ? params[0] : 'history';
  container.appendChild(el('section', { class: 'hero' }, [
    el('div', { class: 'eyebrow', text: 'HISTORY  ·  CHARTS  ·  BODY  ·  GOALS' }),
    el('h1', { text: 'PROGRESS' }),
  ]));
  container.appendChild(el('section', { class: 'section' }, [el('div', { class: 'seg-bar' },
    PROGRESS_SEGS.map(([k, label]) => el('a', { class: 'seg' + (k === seg ? ' seg-on' : ''), href: `#/progress/${k}`, text: label })))]));
  const inner = el('div', {});
  if (seg === 'history') { const m = await import('./history.js?v=31'); await m.renderHistory(inner); }
  else if (seg === 'charts') { const m = await import('./stats.js?v=31'); await m.renderStatsPage(inner, [], { embedded: true, skipBody: true }); }
  else if (seg === 'body') {
    const [{ renderBody }, { renderBodyMeasurementCharts }] = await Promise.all([import('./body.js?v=31'), import('./stats.js?v=31')]);
    inner.appendChild(await renderBodyMeasurementCharts(await db.getAll('bodyMeasurements')));
    await renderBody(inner, []);
  } else { const m = await import('./goals.js?v=31'); await m.renderGoals(inner, []); }
  inner.querySelectorAll(':scope > section.hero').forEach((h) => h.remove());
  container.append(...inner.childNodes);
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
async function refresh() { const m = await import('./app.js?v=31'); m.refresh && m.refresh(); }

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
