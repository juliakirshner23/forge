// =========================================================
// FORGE · Screens
// =========================================================
// One renderer per route. Each takes (container, params) and
// populates the container. Keep DOM building here.
// =========================================================

import * as db from './db.js?v=5';
import { downloadBackup, restoreFromBackupJson } from './export.js?v=5';
import { importBundledHevyBackup, importHevyJson } from './import.js?v=5';

// -------- Shared helpers --------

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'onclick') node.addEventListener('click', v);
    else if (k.startsWith('data-')) node.setAttribute(k, v);
    else if (v != null) node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    if (typeof child === 'string') node.appendChild(document.createTextNode(child));
    else node.appendChild(child);
  }
  return node;
}

function section(labelText, content) {
  return el('section', { class: 'section' }, [
    el('div', { class: 'section-label', text: labelText }),
    content,
  ]);
}

const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS = { mon: 'MON', tue: 'TUE', wed: 'WED', thu: 'THU', fri: 'FRI', sat: 'SAT', sun: 'SUN' };
const DAY_FULL   = { mon: 'MONDAY', tue: 'TUESDAY', wed: 'WEDNESDAY', thu: 'THURSDAY', fri: 'FRIDAY', sat: 'SATURDAY', sun: 'SUNDAY' };

function currentDayKey() {
  // JS: 0=Sun, 1=Mon ... 6=Sat. Our keys: mon-sun.
  const d = new Date().getDay();
  return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d];
}

function todayIso() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function focusTagEl(tag) {
  const tagClassMap = {
    push: 'tag-push', pull: 'tag-pull', legs: 'tag-legs', upper: 'tag-upper',
    core: 'tag-core', rehab: 'tag-rehab', cardio: 'tag-cardio', recovery: 'tag-recovery',
  };
  return el('span', { class: `tag ${tagClassMap[tag] || 'tag-neutral'}`, text: tag.toUpperCase() });
}

function catBadge(category) {
  const map = { strength: 'S', cardio: 'C', core: 'K', mobility: 'M', rehab: 'R' };
  return el('span', { class: `cat cat-${category || 'strength'}`, text: map[category] || '?' });
}

// =========================================================
// HOME
// =========================================================

export async function renderHome(container) {
  const dayKey = currentDayKey();
  const routines = await db.getAll('routines');
  const todaysRoutines = routines.filter((r) => r.scheduledDay === dayKey && r.isActive);
  const measurements = await db.getAll('bodyMeasurements');
  const latestWeight = measurements.length
    ? [...measurements].sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0]
    : null;
  const goals = await db.getAll('goals');
  const inca = goals.find((g) => g.id === 'gl_inca_trail');
  const weightGoal = goals.find((g) => g.id === 'gl_weight');

  const hero = el('section', { class: 'hero' }, [
    el('div', { class: 'eyebrow', text: `${DAY_FULL[dayKey]}  ·  ${new Date().toDateString().toUpperCase()}` }),
    el('h1', { text: 'TODAY' }),
  ]);

  // Today's workout card
  let todayCard;
  if (todaysRoutines.length === 0) {
    todayCard = el('div', { class: 'today-card today-rest' }, [
      el('div', { class: 'today-label', text: 'REST DAY' }),
      el('div', { class: 'today-sub', text: 'NO ROUTINE SCHEDULED FOR TODAY' }),
    ]);
  } else {
    const r = todaysRoutines[0];
    todayCard = el('a', { class: 'today-card', href: `#/routine/${r.id}` }, [
      el('div', { class: 'today-label', text: 'TODAY\'S WORKOUT' }),
      el('div', { class: 'today-name', text: r.name }),
      el('div', { class: 'tag-row' }, (r.focusTags || []).map(focusTagEl)),
      el('div', { class: 'today-meta', text: `${(r.exercises || []).length} EXERCISES  ·  TAP TO VIEW` }),
      el('div', { class: 'today-cta', text: 'START →' }),
    ]);
  }

  // Stats strip
  const statsStrip = el('div', { class: 'stat-strip' }, [
    el('div', { class: 'stat-mini' }, [
      el('span', { class: 'stat-mini-label', text: 'WEIGHT' }),
      el('span', { class: 'stat-mini-value', text: latestWeight?.weight != null ? `${latestWeight.weight}` : '—' }),
      el('span', { class: 'stat-mini-sub', text: latestWeight?.weight != null ? 'LB' : '' }),
    ]),
    el('div', { class: 'stat-mini' }, [
      el('span', { class: 'stat-mini-label', text: 'ROUTINES' }),
      el('span', { class: 'stat-mini-value', text: routines.length }),
      el('span', { class: 'stat-mini-sub', text: 'IN PROGRAM' }),
    ]),
    el('div', { class: 'stat-mini' }, [
      el('span', { class: 'stat-mini-label', text: 'GOALS' }),
      el('span', { class: 'stat-mini-value', text: goals.length }),
      el('span', { class: 'stat-mini-sub', text: 'TRACKED' }),
    ]),
  ]);

  // Countdown card(s)
  const countdownEls = [];
  if (inca?.targetDate) {
    const days = daysUntil(inca.targetDate);
    countdownEls.push(el('div', { class: 'countdown-card' }, [
      el('div', { class: 'countdown-label', text: '◆ INCA TRAIL' }),
      el('div', { class: 'countdown-days', text: `${days} DAYS` }),
      el('div', { class: 'countdown-sub', text: inca.targetDate }),
    ]));
  }
  if (weightGoal?.targetDate) {
    const days = daysUntil(weightGoal.targetDate);
    countdownEls.push(el('div', { class: 'countdown-card' }, [
      el('div', { class: 'countdown-label', text: '◆ WEIGHT GOAL' }),
      el('div', { class: 'countdown-days', text: `${days} DAYS` }),
      el('div', { class: 'countdown-sub', text: `→ ${weightGoal.targetValue} LB` }),
    ]));
  }

  container.appendChild(hero);
  container.appendChild(section("TODAY'S WORKOUT", todayCard));
  container.appendChild(section('QUICK STATS', statsStrip));
  if (countdownEls.length > 0) {
    container.appendChild(section('COUNTDOWNS', el('div', { class: 'countdown-grid' }, countdownEls)));
  }
}

function daysUntil(iso) {
  const target = new Date(iso).getTime();
  return Math.max(0, Math.ceil((target - Date.now()) / 86400000));
}

// =========================================================
// PLAN — Weekly Program
// =========================================================

export async function renderPlan(container) {
  const routines = await db.getAll('routines');
  const activeRoutines = routines.filter((r) => r.isActive !== false);

  // Bucket by day
  const byDay = {};
  for (const key of DAY_ORDER) byDay[key] = [];
  const unscheduled = [];
  for (const r of activeRoutines) {
    if (r.scheduledDay && DAY_ORDER.includes(r.scheduledDay)) byDay[r.scheduledDay].push(r);
    else unscheduled.push(r);
  }

  const todayKey = currentDayKey();

  const hero = el('section', { class: 'hero' }, [
    el('div', { class: 'eyebrow', text: `WEEKLY PROGRAM  ·  ${activeRoutines.length} ROUTINES` }),
    el('h1', { text: 'THIS WEEK' }),
    el('p', { class: 'hero-sub', text: 'Tap a day to see its routine and exercises.' }),
  ]);
  container.appendChild(hero);

  // Day cards section
  const dayList = el('div', { class: 'day-list' });
  for (const key of DAY_ORDER) {
    const rs = byDay[key];
    const isToday = key === todayKey;
    dayList.appendChild(dayCard(key, rs, isToday));
  }
  container.appendChild(section('SCHEDULE', dayList));

  if (unscheduled.length > 0) {
    const others = el('div', { class: 'day-list' });
    for (const r of unscheduled) {
      others.appendChild(routineRow(r, { showDay: false }));
    }
    container.appendChild(section(`UNSCHEDULED  ·  ${unscheduled.length}`, others));
  }

  // Link to exercise library (stub for now)
  container.appendChild(
    section(
      'LIBRARY',
      el('a', { class: 'nav-row', href: '#/library' }, [
        el('div', { class: 'nav-row-main' }, [
          el('div', { class: 'nav-row-title', text: 'EXERCISE LIBRARY' }),
          el('div', { class: 'nav-row-sub', text: 'BROWSE, EDIT, AND ORGANIZE YOUR EXERCISES' }),
        ]),
        el('div', { class: 'nav-row-arrow', text: '›' }),
      ])
    )
  );
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
    children.push(el('div', { class: 'day-body' }, [
      el('div', { class: 'day-empty', text: 'REST' }),
    ]));
  } else {
    const body = el('div', { class: 'day-body' });
    for (const r of routines) {
      const link = el('a', { class: 'day-routine-link', href: `#/routine/${r.id}` }, [
        el('div', { class: 'day-routine-name', text: r.name }),
        el('div', { class: 'tag-row day-tag-row' }, (r.focusTags || []).map(focusTagEl)),
        el('div', { class: 'day-routine-meta', text: `${(r.exercises || []).length} EXERCISES` }),
      ]);
      body.appendChild(link);
    }
    children.push(body);
  }

  return el('div', { class: cardClass }, children);
}

function routineRow(r, opts = {}) {
  return el('a', { class: 'nav-row', href: `#/routine/${r.id}` }, [
    el('div', { class: 'nav-row-main' }, [
      el('div', { class: 'nav-row-title', text: r.name }),
      el('div', { class: 'nav-row-sub', text: `${(r.exercises || []).length} EXERCISES${r.folderName ? '  ·  ' + r.folderName.toUpperCase() : ''}` }),
    ]),
    el('div', { class: 'nav-row-arrow', text: '›' }),
  ]);
}

// =========================================================
// ROUTINE DETAIL
// =========================================================

export async function renderRoutine(container, params) {
  const [routineId] = params;
  const routine = routineId ? await db.get('routines', routineId) : null;

  if (!routine) {
    container.appendChild(el('section', { class: 'hero' }, [
      el('div', { class: 'eyebrow', text: 'ERROR' }),
      el('h1', { text: 'ROUTINE NOT FOUND' }),
      el('a', { class: 'nav-row', href: '#/plan', style: 'margin-top: 20px;' }, [
        el('div', { class: 'nav-row-main' }, [ el('div', { class: 'nav-row-title', text: '← BACK TO PLAN' }) ]),
      ]),
    ]));
    return;
  }

  // Look up exercise names/categories from library
  const allExercises = await db.getAll('exercises');
  const exById = new Map(allExercises.map((e) => [e.id, e]));

  const hero = el('section', { class: 'hero' }, [
    el('div', { class: 'eyebrow' }, [
      el('a', { href: '#/plan', class: 'crumb', text: '‹ PLAN' }),
      el('span', { text: '  ·  ' + (routine.folderName || 'ROUTINE').toUpperCase() }),
    ]),
    el('h1', { text: routine.name }),
    el('p', { class: 'hero-meta', text: `${routine.scheduledDay ? DAY_FULL[routine.scheduledDay] + '  ·  ' : ''}${(routine.exercises || []).length} EXERCISES` }),
    routine.focusTags && routine.focusTags.length > 0
      ? el('div', { class: 'tag-row', style: 'margin-top: 12px;' }, routine.focusTags.map(focusTagEl))
      : null,
  ]);
  container.appendChild(hero);

  // Exercise list
  const exercises = routine.exercises || [];
  if (exercises.length === 0) {
    container.appendChild(section('EXERCISES', el('div', { class: 'empty-note', text: 'NO EXERCISES IN THIS ROUTINE' })));
  } else {
    const list = el('div', { class: 'exercise-list' });
    exercises.forEach((ex, idx) => {
      const libEx = exById.get(ex.exerciseId);
      const category = libEx?.category || 'strength';
      list.appendChild(exerciseRow(ex, idx, category, libEx));
    });
    container.appendChild(section(`EXERCISES  ·  ${exercises.length}`, list));
  }

  // Start button (stub - workout execution comes in a later phase)
  container.appendChild(section('', el('button', { class: 'btn btn-primary', onclick: () => toast('WORKOUT EXECUTION COMES IN THE NEXT PHASE', 'ok') }, [
    el('span', { class: 'btn-title', text: 'START WORKOUT' }),
    el('span', { class: 'btn-sub', text: 'PHASE 2B  ·  COMING NEXT' }),
  ])));
}

function exerciseRow(ex, idx, category, libEx) {
  const setsCount = (ex.sets || []).length;
  const firstSet = (ex.sets || [])[0];

  let setsSummary = `${setsCount} SET${setsCount === 1 ? '' : 'S'}`;
  if (firstSet) {
    if (firstSet.durationSec != null) {
      setsSummary += `  ·  ${formatDuration(firstSet.durationSec)}`;
    } else if (firstSet.reps != null) {
      setsSummary += ` × ${firstSet.reps}`;
      if (firstSet.weightLb != null) setsSummary += `  ·  ${firstSet.weightLb} LB`;
    }
  }
  if (ex.restBetweenSets) {
    setsSummary += `  ·  REST ${ex.restBetweenSets}S`;
  }

  const constraintFlag = libEx?.constraintFlags?.length > 0;

  return el('div', { class: 'exercise-row' }, [
    el('div', { class: 'exercise-num', text: idx + 1 }),
    catBadge(category),
    el('div', { class: 'exercise-main' }, [
      el('div', { class: 'exercise-name', text: ex.exerciseName || libEx?.name || '(unknown)' }),
      el('div', { class: 'exercise-meta', text: setsSummary }),
    ]),
    constraintFlag ? el('div', { class: 'exercise-flag', text: '⚑' }) : null,
  ]);
}

function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}S`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}M` : `${m}M ${s}S`;
}

// =========================================================
// LIBRARY (stub for this phase)
// =========================================================

export async function renderLibrary(container) {
  const exercises = await db.getAll('exercises');
  container.appendChild(el('section', { class: 'hero' }, [
    el('div', { class: 'eyebrow', text: `EXERCISE LIBRARY  ·  ${exercises.length} EXERCISES` }),
    el('h1', { text: 'YOUR LIBRARY' }),
    el('p', { class: 'hero-sub', text: 'Full library UI (browse catalog, edit, custom exercises) lands in the next phase. For now, this is a quick list of what\'s imported.' }),
  ]));

  const sorted = [...exercises].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const list = el('div', { class: 'exercise-list' });
  sorted.forEach((ex, idx) => {
    list.appendChild(el('div', { class: 'exercise-row' }, [
      el('div', { class: 'exercise-num', text: idx + 1 }),
      catBadge(ex.category),
      el('div', { class: 'exercise-main' }, [
        el('div', { class: 'exercise-name' }, [
          document.createTextNode(ex.name),
          ex.isCustom ? el('span', { class: 'inline-badge', text: 'CUSTOM' }) : null,
        ]),
        el('div', { class: 'exercise-meta', text: `${ex.equipment || 'BODYWEIGHT'}${ex.category ? '  ·  ' + ex.category.toUpperCase() : ''}` }),
      ]),
      ex.constraintFlags?.length > 0
        ? el('div', { class: 'exercise-flag', text: '⚑' })
        : null,
    ]));
  });
  container.appendChild(section('ALL EXERCISES  ·  ALPHABETICAL', list));
}

// =========================================================
// STUB SCREENS: LOG, STATS
// =========================================================

export async function renderLog(container) {
  container.appendChild(el('section', { class: 'hero' }, [
    el('div', { class: 'eyebrow', text: 'PHASE 2C  ·  COMING NEXT' }),
    el('h1', { text: 'WORKOUT LOG' }),
    el('p', { class: 'hero-sub', text: 'Start a workout, log sets with the rest timer, review your session history. All lands in the next build.' }),
  ]));
}

export async function renderStats(container) {
  container.appendChild(el('section', { class: 'hero' }, [
    el('div', { class: 'eyebrow', text: 'PHASE 3  ·  COMING SOON' }),
    el('h1', { text: 'PROGRESS & STATS' }),
    el('p', { class: 'hero-sub', text: 'Weight/rep trends per exercise, body measurements charts, PR tracking, weekly volume. All lands after workout execution ships.' }),
  ]));
}

// =========================================================
// ME (data / backup / settings) — this is the old Vault
// =========================================================

export async function renderMe(container) {
  const [exCount, rtCount, sessCount, bmCount, daCount, goalCount] = await Promise.all([
    db.count('exercises'), db.count('routines'), db.count('sessions'),
    db.count('bodyMeasurements'), db.count('dailyActivity'), db.count('goals'),
  ]);
  const meta = await db.get('meta', 'lastImport');
  const lastImportDate = meta?.value?.importedAt ? new Date(meta.value.importedAt) : null;

  const hero = el('section', { class: 'hero' }, [
    el('div', { class: 'eyebrow', text: 'ME  ·  DATA  ·  SETTINGS' }),
    el('h1', { text: 'YOUR VAULT' }),
    el('p', { class: 'hero-sub', text: 'Everything below lives on this device. Nothing syncs. Back it up regularly.' }),
    el('p', { class: 'hero-meta', text: lastImportDate
      ? `LAST IMPORT · ${Math.floor((Date.now() - lastImportDate.getTime()) / 86400000)}D AGO`
      : 'NO IMPORT YET' }),
  ]);
  container.appendChild(hero);

  // Data status grid
  const grid = el('div', { class: 'stat-grid' });
  const cards = [
    { store: 'exercises',        label: 'EXERCISES',        value: exCount,   sub: 'IN LIBRARY',      highlight: true },
    { store: 'routines',         label: 'ROUTINES',         value: rtCount,   sub: 'ALL PROGRAMS' },
    { store: 'bodyMeasurements', label: 'MEASUREMENTS',     value: bmCount,   sub: 'BODY LOG' },
    { store: 'sessions',         label: 'SESSIONS',         value: sessCount, sub: 'WORKOUTS LOGGED' },
    { store: 'goals',            label: 'GOALS',            value: goalCount, sub: 'TRACKED' },
    { store: 'dailyActivity',    label: 'DAILY ACTIVITY',   value: daCount,   sub: 'DAYS LOGGED' },
  ];
  for (const c of cards) {
    const card = el('div', { class: 'stat-card' }, [
      el('span', { class: 'stat-label', text: c.label }),
      el('div', {}, [
        el('div', { class: 'stat-value', text: c.value }),
        el('div', { class: 'stat-sub', text: c.sub }),
      ]),
    ]);
    if (c.highlight) card.setAttribute('data-highlight', '');
    if (c.value > 0) {
      card.setAttribute('data-tappable', '');
      card.addEventListener('click', () => openInspector(c.store, c.label));
    }
    grid.appendChild(card);
  }
  container.appendChild(section('DATA STATUS  ·  TAP A CARD TO INSPECT', grid));

  // Settings preview
  container.appendChild(section('SETTINGS  ·  CONSTRAINTS', await settingsPreview()));

  // Backup & restore
  const backupStack = el('div', { class: 'action-stack' }, [
    btnCard('EXPORT BACKUP', 'DOWNLOAD JSON · SAVE TO DRIVE / iCLOUD', 'primary', onExport),
    btnCard('IMPORT BACKUP', 'RESTORE FROM JSON FILE', 'outline', onImportClick),
  ]);
  container.appendChild(section('BACKUP & RESTORE', backupStack));

  // Advanced
  const advStack = el('div', { class: 'action-stack' }, [
    btnCard('SEED 4 DEFAULT GOALS', 'DIRECT DB WRITE · SKIPS IMPORT', 'outline', onSeedGoalsClick),
    btnCard('CLEAR ALL DATA', 'WIPE THIS DEVICE · IRREVERSIBLE', 'danger', onClearClick),
    btnCard('RE-IMPORT BUNDLED HEVY DATA', "RESTORE FROM APP'S SEED FILE", 'outline', onReimportClick),
  ]);
  container.appendChild(section('ADVANCED', advStack));

  // Footer
  const est = await db.storageEstimate();
  let storageText = 'ESTIMATE UNAVAILABLE';
  if (est) {
    const usedMb = (est.usage / 1024 / 1024).toFixed(2);
    const quotaMb = (est.quota / 1024 / 1024).toFixed(0);
    const pct = ((est.usage / est.quota) * 100).toFixed(2);
    storageText = `${usedMb} MB USED  ·  ${quotaMb} MB AVAILABLE  ·  ${pct}%`;
  }
  container.appendChild(el('section', { class: 'section footer-note' }, [
    el('p', { text: `Storage: ${storageText}` }),
  ]));
}

async function settingsPreview() {
  const [units, stride, stepGoal, prompts, backup, profile, constraints] = await Promise.all([
    db.getSetting('units'), db.getSetting('strideLengthIn'), db.getSetting('stepGoal'),
    db.getSetting('promptSensitivity'), db.getSetting('backupReminder'),
    db.getSetting('profile'), db.getSetting('constraints'),
  ]);

  const box = el('div', { class: 'settings-list' });
  const rows = [];
  if (profile?.name) rows.push({ key: 'PROFILE', value: profile.name });
  if (units) rows.push({ key: 'UNITS', value: `${(units.weight || '?').toUpperCase()} · ${(units.distance || '?').toUpperCase()} · ${(units.measurement || '?').toUpperCase()}` });
  if (stride != null) rows.push({ key: 'STRIDE LENGTH', value: `${stride} IN` });
  if (stepGoal != null) rows.push({ key: 'DAILY STEP GOAL', value: stepGoal.toLocaleString() });
  if (prompts) rows.push({ key: 'PROMPT SENSITIVITY', value: prompts.toUpperCase() });
  if (backup) rows.push({ key: 'BACKUP REMINDER', value: backup.toUpperCase() });
  if (constraints) {
    rows.push({ key: 'CONSTRAINTS', value: constraints.summary || (constraints.active ? 'ACTIVE' : 'NONE'), warn: constraints.active === true });
    if (constraints.clearanceExpected) rows.push({ key: 'PT CLEARANCE', value: constraints.clearanceExpected });
  }
  if (rows.length === 0) {
    box.appendChild(el('div', { class: 'settings-row' }, [el('span', { class: 'settings-key', text: 'NO SETTINGS SAVED' })]));
    return box;
  }
  for (const r of rows) {
    box.appendChild(el('div', { class: 'settings-row' }, [
      el('span', { class: 'settings-key', text: r.key }),
      el('span', { class: `settings-value${r.warn ? ' settings-value-warn' : ''}`, text: r.value }),
    ]));
  }
  return box;
}

function btnCard(title, sub, variant, onClick) {
  const btn = el('button', { class: `btn btn-${variant}`, onclick: onClick }, [
    el('span', { class: 'btn-title', text: title }),
    el('span', { class: 'btn-sub', text: sub }),
  ]);
  return btn;
}

// -------- Vault action handlers --------

async function onExport() {
  try {
    const result = await downloadBackup();
    const kb = (result.size / 1024).toFixed(1);
    toast(`EXPORTED  ·  ${result.filename}  ·  ${kb} KB`, 'ok');
  } catch (err) {
    console.error(err);
    toast('EXPORT FAILED · ' + err.message, 'error');
  }
}

function onImportClick() {
  document.getElementById('file-input').click();
}

async function onSeedGoalsClick() {
  const goals = [
    { id: 'gl_inca_trail',   type: 'event',     title: 'Inca Trail',                             targetDate: '2027-04-19', createdAt: new Date().toISOString() },
    { id: 'gl_weight',       type: 'weight',    title: 'Goal Weight',                            targetValue: 170, targetDate: '2027-03-30', startValue: 266, createdAt: new Date().toISOString() },
    { id: 'gl_pushup',       type: 'pushup',    title: '3 Full Push-Ups',                        targetDate: '2027-01-31', createdAt: new Date().toISOString() },
    { id: 'gl_pt_clearance', type: 'clearance', title: 'PT Clearance · Unrestricted Lower Body', targetDate: '2027-09-01', createdAt: new Date().toISOString() },
  ];
  try {
    for (const g of goals) await db.put('goals', g);
    const count = await db.count('goals');
    toast(`SEEDED  ·  GOALS STORE NOW HAS ${count}`, 'ok', 3500);
    await refreshCurrentScreen();
  } catch (err) {
    console.error(err);
    toast('SEED FAILED · ' + err.message, 'error', 5000);
  }
}

function onClearClick() {
  confirmModal(
    'CLEAR ALL DATA?',
    'This wipes every exercise, routine, session, measurement, and setting from this device. If you have no backup, this data is gone. Export first.',
    async () => {
      try {
        await db.clearAll();
        toast('DATA CLEARED', 'ok');
        await refreshCurrentScreen();
      } catch (err) {
        console.error(err);
        toast('CLEAR FAILED · ' + err.message, 'error');
      }
    }
  );
}

function onReimportClick() {
  confirmModal(
    'RE-IMPORT BUNDLED HEVY DATA?',
    "Wipes current data and reloads the app's bundled Hevy seed file.",
    async () => {
      try {
        await db.clearAll();
        const summary = await importBundledHevyBackup();
        toast(`REIMPORTED  ·  ${summary.exercises} EX  ·  ${summary.routines} ROUTINES  ·  ${summary.goals} GOALS`, 'ok', 3500);
        await refreshCurrentScreen();
      } catch (err) {
        console.error(err);
        toast('RE-IMPORT FAILED · ' + err.message, 'error');
      }
    }
  );
}

async function onFileChosen(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    const isForgeBackup = json.export_metadata?.app === 'FORGE';
    const label = isForgeBackup ? 'FORGE backup' : 'Hevy backup';
    confirmModal(
      `RESTORE FROM ${label.toUpperCase()}?`,
      "This wipes current data and replaces it with the file's contents.",
      async () => {
        try {
          let summary;
          if (isForgeBackup) summary = await restoreFromBackupJson(json);
          else {
            await db.clearAll();
            summary = await importHevyJson(json);
          }
          const total = Object.values(summary).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
          toast(`RESTORED · ${total} ITEMS`, 'ok', 3500);
          await refreshCurrentScreen();
        } catch (err) {
          console.error(err);
          toast('IMPORT FAILED · ' + err.message, 'error');
        }
      }
    );
  } catch (err) {
    console.error(err);
    toast('INVALID FILE · ' + err.message, 'error');
  }
}

// Wire file input once (module-level)
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('file-input')?.addEventListener('change', onFileChosen);
});

// =========================================================
// Toast, modal, inspector — shared UI utilities
// =========================================================

let toastTimer = null;
export function toast(msg, kind = '', duration = 2500) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast show ' + (kind === 'ok' ? 'toast-ok' : kind === 'error' ? 'toast-error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = 'toast ' + (kind === 'ok' ? 'toast-ok' : kind === 'error' ? 'toast-error' : '');
  }, duration);
}

export function confirmModal(title, body, onConfirm) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').textContent = body;
  document.getElementById('modal-scrim').hidden = false;

  const btn = document.getElementById('modal-confirm');
  const fresh = btn.cloneNode(true);
  btn.parentNode.replaceChild(fresh, btn);
  fresh.addEventListener('click', async () => {
    hideModal();
    if (onConfirm) await onConfirm();
  });
  document.getElementById('modal-cancel').onclick = hideModal;
}

function hideModal() {
  document.getElementById('modal-scrim').hidden = true;
}

async function openInspector(store, label) {
  const rows = await db.getAll(store);
  document.getElementById('inspector-title').textContent = `${label} · ${rows.length}`;
  const body = document.getElementById('inspector-body');
  body.innerHTML = '';

  if (rows.length === 0) {
    body.innerHTML = `<div class="inspector-empty">EMPTY</div>`;
  } else {
    const renderer = INSPECTOR_RENDERERS[store] || renderGenericItem;
    const sorted = INSPECTOR_SORTERS[store] ? [...rows].sort(INSPECTOR_SORTERS[store]) : rows;
    for (const row of sorted) {
      const div = document.createElement('div');
      div.className = 'inspector-item';
      div.innerHTML = renderer(row);
      body.appendChild(div);
    }
  }
  document.getElementById('inspector-scrim').hidden = false;
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('inspector-close')?.addEventListener('click', () => {
    document.getElementById('inspector-scrim').hidden = true;
  });
  document.getElementById('inspector-scrim')?.addEventListener('click', (e) => {
    if (e.target.id === 'inspector-scrim') document.getElementById('inspector-scrim').hidden = true;
  });
});

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const INSPECTOR_RENDERERS = {
  exercises: (r) => `<div class="inspector-item-main"><span class="inspector-category cat-${r.category || 'strength'}">${(r.category || 'STR').toUpperCase().slice(0, 4)}</span>${esc(r.name)}${r.isCustom ? ' <span class="inspector-item-meta">· CUSTOM</span>' : ''}</div><div class="inspector-item-meta">${esc(r.equipment || '')}</div>`,
  routines: (r) => `<div class="inspector-item-main">${esc(r.name)}${r.folderName ? ` <span class="inspector-item-meta">· ${esc(r.folderName)}</span>` : ''}</div><div class="inspector-item-meta">${(r.exercises || []).length} EX</div>`,
  bodyMeasurements: (r) => `<div class="inspector-item-main">${esc(r.date)}</div><div class="inspector-item-meta">${r.weight != null ? r.weight + ' LB' : '—'}</div>`,
  sessions: (r) => `<div class="inspector-item-main">${esc(r.routineName || r.name || '(session)')}</div><div class="inspector-item-meta">${(r.completedAt || r.startedAt || '').slice(0, 10)}</div>`,
  goals: (r) => `<div class="inspector-item-main">${esc(r.title)}${r.type ? ` <span class="inspector-item-meta">· ${esc(r.type.toUpperCase())}</span>` : ''}</div><div class="inspector-item-meta">${r.targetDate ? esc(r.targetDate) : (r.targetValue != null ? r.targetValue : '')}</div>`,
  dailyActivity: (r) => `<div class="inspector-item-main">${esc(r.date)}</div><div class="inspector-item-meta">${r.steps != null ? r.steps.toLocaleString() + ' STEPS' : '—'}</div>`,
};

function renderGenericItem(r) {
  return `<div class="inspector-item-main">${esc(r.id || r.date || r.key || '(no id)')}</div>`;
}

const INSPECTOR_SORTERS = {
  bodyMeasurements: (a, b) => (b.date || '').localeCompare(a.date || ''),
  dailyActivity:    (a, b) => (b.date || '').localeCompare(a.date || ''),
  exercises:        (a, b) => (a.name || '').localeCompare(b.name || ''),
  routines:         (a, b) => (a.name || '').localeCompare(b.name || ''),
  goals:            (a, b) => (a.targetDate || '').localeCompare(b.targetDate || ''),
  sessions:         (a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''),
};

// -------- Cross-screen refresh --------
async function refreshCurrentScreen() {
  // Router imports & re-invokes; import here to avoid circular
  const { refresh } = await import('./app.js?v=5');
  if (refresh) refresh();
}
