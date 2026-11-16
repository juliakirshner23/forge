// FORGE v1.0.0 · Program: phases, blocks, scheduling, exercise guides
import * as db from './db.js?v=27';
import { EXDEFS, OTHER_GUIDES, PHASE1_BLOCKS, PHASE2_BLOCKS } from './program-data.js?v=27';

// ---------- Categories (one field, used everywhere) ----------
export const CATS = ['push', 'pull', 'legs', 'core', 'cardio', 'rehab'];
export const CAT_LABEL = { push: 'PUSH', pull: 'PULL', legs: 'LEGS', core: 'CORE', cardio: 'CARDIO', rehab: 'REHAB' };

// ---------- Phases ----------
export const PHASES = [
  { id: 'p1', name: 'PHASE I',   start: '2026-11-16', end: '2027-01-04', dates: 'NOV 16 – JAN 4',
    where: 'GYM · PRE-SURGERY · ELLIPTICAL CARDIO · LEFT-LEG FOCUS' },
  { id: 'p2', name: 'PHASE II',  start: '2027-01-10', end: '2027-02-28', dates: 'JAN 10 – FEB 28',
    where: 'HOME · SEATED ONLY · NO FLOOR WORK · NO WEIGHT ON THE RIGHT LEG' },
  { id: 'p3', name: 'PHASE III', start: '2027-03-01', end: null, dates: 'FROM MAR 1',
    where: 'REHAB · PT-GUIDED',
    placeholder: 'Cardio and leg work will follow your PT. Details to be added. Upper body continues: pull-up progression, hangs, and grip.' },
  { id: 'p4', name: 'PHASE IV',  start: null, end: null, dates: '~JUN – JUL 2027',
    where: 'INCA TRAIL TRAINING · CALISTHENICS · CLIMBING · NO HIGH IMPACT',
    placeholder: 'Details to be added: hike training, calisthenics, and climbing strength.' },
];
const BLOCKS = { p1: PHASE1_BLOCKS, p2: PHASE2_BLOCKS };

export function phaseById(id) { return PHASES.find((p) => p.id === id) || null; }

// Phase in effect on a date, or the next one coming up.
export function currentPhase(iso) {
  const active = PHASES.find((p) => p.start && p.start <= iso && (!p.end || iso <= p.end));
  if (active) return active;
  return PHASES.find((p) => p.start && p.start > iso) || PHASES[PHASES.length - 1];
}

// Countdown: days left counting today (or the start day) and the last day.
export function phaseCountdown(phase, todayIso) {
  if (!phase.start || !phase.end) return null;
  const from = todayIso < phase.start ? phase.start : todayIso;
  if (from > phase.end) return { daysLeft: 0, startsIn: 0, total: daysBetween(phase.start, phase.end) + 1 };
  return {
    daysLeft: daysBetween(from, phase.end) + 1,
    startsIn: todayIso < phase.start ? daysBetween(todayIso, phase.start) : 0,
    total: daysBetween(phase.start, phase.end) + 1,
  };
}

// ---------- Local date helpers (phone time zone) ----------
export function isoOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function parseIso(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); }
export function addDaysIso(iso, n) { const d = parseIso(iso); d.setDate(d.getDate() + n); return isoOf(d); }
export function daysBetween(a, b) { return Math.round((parseIso(b) - parseIso(a)) / 86400000); }
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export function dayKeyOfIso(iso) { return DAY_KEYS[parseIso(iso).getDay()]; }
export function weekDates(iso) {
  const d = parseIso(iso);
  const back = (d.getDay() + 6) % 7; // Monday start
  const mon = addDaysIso(iso, -back);
  return Array.from({ length: 7 }, (_, i) => addDaysIso(mon, i));
}

// ---------- Scheduling ----------
// routine.scheduleDays: ['mon','thu'] repeats weekly (within its phase, from scheduleFrom)
// routine.scheduleDates: ['2026-11-20'] one-off dates
// routine.scheduledDay: legacy single weekday, still honored
export function isScheduledOn(r, iso) {
  if (!r || r.isActive === false) return false;
  if ((r.scheduleDates || []).includes(iso)) return true;
  const days = r.scheduleDays && r.scheduleDays.length ? r.scheduleDays : (r.scheduledDay ? [r.scheduledDay] : []);
  if (!days.includes(dayKeyOfIso(iso))) return false;
  if (r.scheduleFrom && iso < r.scheduleFrom) return false;
  const ph = r.phaseId ? phaseById(r.phaseId) : null;
  if (ph && ph.start && iso < ph.start) return false;
  if (ph && ph.end && iso > ph.end) return false;
  return true;
}
export function routinesOn(routines, iso) { return (routines || []).filter((r) => isScheduledOn(r, iso)); }

export function scheduleSummary(r) {
  const parts = [];
  const days = r.scheduleDays && r.scheduleDays.length ? r.scheduleDays : (r.scheduledDay ? [r.scheduledDay] : []);
  if (days.length) {
    const order = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    parts.push('EVERY ' + order.filter((d) => days.includes(d)).map((d) => d.toUpperCase()).join(', '));
  }
  const dates = (r.scheduleDates || []).slice().sort();
  if (dates.length) parts.push(dates.map((x) => shortDate(x)).join(', '));
  return parts.length ? parts.join('  ·  ') : 'NOT ON A DAY YET';
}
export function shortDate(iso) {
  return parseIso(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase();
}

// ---------- Blocks ----------
export function targetText(e) {
  const range = e.lo != null && e.hi != null && e.lo !== e.hi ? `${e.lo}–${e.hi}` : (e.lo ?? '');
  if (e.unit === 'max') return `${e.sets} × MAX`;
  if (e.unit === 'min') return `${range} MIN`;
  if (e.unit === 'sec') return `${e.sets} × ${range} SEC`;
  if (e.unit === 'reps_side') return `${e.sets} × ${range}/SIDE`;
  return `${e.sets} × ${range}`;
}

// Resolved blocks for a phase: { cat: [{ ...entry, exerciseId, altIds }] }
export async function phaseBlocks(phaseId) {
  const raw = BLOCKS[phaseId];
  if (!raw) return null;
  const idMap = (await db.getSetting('programExerciseIds')) || {};
  const out = {};
  for (const cat of Object.keys(raw)) {
    out[cat] = raw[cat].map((e) => ({
      ...e,
      exerciseId: idMap[e.key] || null,
      exerciseName: EXDEFS[e.key]?.name || e.key,
      altIds: (e.alts || []).map((k) => idMap[k]).filter(Boolean),
      target: targetText(e),
    }));
  }
  return out;
}

// One block entry → one routine exercise (same shape the routine editor uses).
export function routineEntryFromBlock(e, order) {
  const n = Math.max(1, e.sets || 1);
  const mk = () => {
    if (e.unit === 'min') return { type: 'normal', durationSec: (e.lo || 30) * 60, reps: null, weightLb: null };
    if (e.unit === 'sec') return { type: 'normal', reps: e.lo || 30, weightLb: null, durationSec: null }; // hold: log seconds as reps
    if (e.unit === 'max') return { type: 'normal', reps: null, weightLb: null, durationSec: null };
    return { type: 'normal', reps: e.lo ?? 10, weightLb: null, durationSec: null };
  };
  return {
    exerciseId: e.exerciseId,
    exerciseName: e.exerciseName,
    order,
    restBetweenSets: null,
    supersetGroupId: null,
    substituteIds: e.altIds || [],
    notes: [e.target, e.note].filter(Boolean).join(' · '),
    sets: Array.from({ length: e.unit === 'min' ? 1 : n }, mk),
  };
}

// Phase target for an exercise, if it is in a phase's blocks.
export async function targetsForExercise(exerciseId) {
  const res = [];
  for (const ph of PHASES) {
    const b = await phaseBlocks(ph.id);
    if (!b) continue;
    for (const cat of Object.keys(b)) for (const e of b[cat]) {
      if (e.exerciseId === exerciseId) res.push({ phase: ph.name, target: e.target, note: e.note });
    }
  }
  return res;
}

// ---------- Exercise guides (photos + instructions) ----------
let _guides = null;
export async function getGuides() {
  if (_guides) return _guides;
  try { _guides = await (await fetch('data/guides.json?v=27')).json(); }
  catch (err) { console.error('Guides load failed', err); _guides = {}; }
  return _guides;
}
export async function guideFor(ex) {
  const g = await getGuides();
  if (ex.guideKey && g[ex.guideKey]) return g[ex.guideKey];
  const slug = (ex.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return g[slug] || null;
}

// ---------- v1.0.0 migration ----------
const CATEGORY_OVERRIDES = {
  'iyt': 'push',
  'straight leg raise': 'core',
  'side lying hip abduction': 'rehab',
  'single leg glute bridge': 'legs',
  'lat pulldown (cable)': 'pull',
  'seated cable row - v grip (cable)': 'pull',
  'triceps extension (cable)': 'push',
  'heel taps': 'core',
  'reverse crunch': 'core',
  'bicycle crunch': 'core',
  'hanging knee raise': 'core',
  'hip abduction (machine)': 'legs',
  'hip adduction (machine)': 'legs',
};
const EQUIPMENT_OVERRIDES = { 'goblet squat': 'Dumbbell' };

export function normalizeCategory(ex) {
  const n = (ex.name || '').toLowerCase();
  if (CATEGORY_OVERRIDES[n]) return CATEGORY_OVERRIDES[n];
  if (CATS.includes(ex.category)) return ex.category;
  if (ex.category === 'cardio' || ex.cardioMachine) return 'cardio';
  if (CATS.includes(ex.focus)) return ex.focus;
  if (ex.focus === 'mobility') return 'push';
  return 'legs';
}

export async function migrateV100() {
  const done = await db.get('meta', 'migrated_v100');
  if (done) return null;
  const nowIso = new Date().toISOString();
  const [routines, exercises] = await Promise.all([db.getAll('routines'), db.getAll('exercises')]);

  // 1 · Keep a copy of what existed before, in case anything needs restoring.
  await db.put('meta', { key: 'backup_pre_v100', value: { at: nowIso, routines, exercises } });

  // 2 · One category field, fixed labels and equipment, guide links.
  const byName = new Map(exercises.map((e) => [(e.name || '').toLowerCase(), e]));
  for (const ex of exercises) {
    const n = (ex.name || '').toLowerCase();
    ex.category = normalizeCategory(ex);
    ex.focus = ex.category;
    if (EQUIPMENT_OVERRIDES[n]) ex.equipment = EQUIPMENT_OVERRIDES[n];
    if (OTHER_GUIDES[ex.name]) ex.guideKey = OTHER_GUIDES[ex.name];
    ex.updatedAt = nowIso;
  }

  // 3 · Program exercises: reuse what's in the library, create the rest.
  const idMap = {};
  for (const [key, d] of Object.entries(EXDEFS)) {
    const existing = byName.get((d.existing || d.name).toLowerCase());
    if (existing) {
      existing.category = d.cat; existing.focus = d.cat;
      existing.guideKey = d.guideKey;
      idMap[key] = existing.id;
      continue;
    }
    const rec = {
      id: 'pg_' + key, name: d.name, category: d.cat, focus: d.cat, equipment: d.eq,
      cardioMachine: d.cat === 'cardio' && /elliptical/i.test(d.name) ? 'elliptical' : null,
      primaryMuscles: [], secondaryMuscles: [], isCustom: true, notes: '',
      substituteIds: [], constraintFlags: [], hevyTemplateId: null, guideKey: d.guideKey,
      createdAt: nowIso, updatedAt: nowIso,
    };
    exercises.push(rec);
    byName.set(d.name.toLowerCase(), rec);
    idMap[key] = rec.id;
  }

  // 4 · Alternatives live on the exercise too, so the detail screen can show them.
  const exById = new Map(exercises.map((e) => [e.id, e]));
  for (const blocks of Object.values(BLOCKS)) for (const list of Object.values(blocks)) for (const e of list) {
    const ex = exById.get(idMap[e.key]);
    if (!ex) continue;
    const alts = (e.alts || []).map((k) => idMap[k]).filter(Boolean);
    ex.substituteIds = [...new Set([...(ex.substituteIds || []), ...alts])];
  }
  await db.putMany('exercises', exercises);

  // 5 · Start fresh: remove the old routines (history stays). Keep their old
  // weekdays so trail points for days before today don't change.
  const oldDays = [...new Set(routines.filter((r) => r.isActive !== false && r.scheduledDay).map((r) => r.scheduledDay))];
  const t = new Date();
  const todayLocal = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  await db.setSetting('legacySchedule', { days: oldDays, until: todayLocal });
  for (const r of routines) await db.remove('routines', r.id);

  await db.setSetting('programExerciseIds', idMap);
  await db.put('meta', { key: 'migrated_v100', value: { at: nowIso, removedRoutines: routines.length } });
  return { removedRoutines: routines.length };
}

// ---------- v1.0.1 · Fresh start ----------
// Wipes workouts, food, steps, body entries, and trail progress. Keeps the
// exercise library, routines, goals, and settings. Trail starts Nov 16, 2026.
export async function migrateV101FreshStart() {
  if (await db.get('meta', 'fresh_start_v101')) return false;
  for (const store of ['sessions', 'bodyMeasurements', 'dailyActivity', 'foods', 'mealLog', 'dailyCalorieAdjustments']) {
    await db.clear(store);
  }
  for (const key of ['trailLedger', 'trailBadges', 'backup_pre_v100']) await db.remove('meta', key);
  await db.remove('settings', 'legacySchedule');
  await db.setSetting('trailPauses', []);
  await db.setSetting('trailStartDate', '2026-11-16');
  await db.put('meta', { key: 'fresh_start_v101', value: { at: new Date().toISOString() } });
  return true;
}
