// FORGE trail habit layer (v0.9.0)
// Turns logged workouts into progress along the Classic Inca Trail.
//
// Rules (agreed Nov 2026):
//  - Goal: 44 km (27.3 mi), high point 4,215 m, 2,860 m positive gain. Completion
//    needs BOTH the distance and the climb.
//  - Treadmill: distance from speed × time, climb = distance × incline.
//  - Elliptical / bike / rower / other: distance from speed × time, climb from the
//    heart-rate → incline calibration table (3.0 mph treadmill).
//  - Stairmaster: climb = steps × step height (setting). No horizontal distance.
//  - Outdoor run: distance only.
//  - Strength: strength minutes count as 3.0 mph walking at the incline that matches
//    the session's average heart rate, at 1/4 credit.
//  - Credit is computed once per session and stored in a ledger, so calibration
//    changes apply to new sessions only.
//  - Points: workout 60 × share of sets done × streak multiplier; +10 per meal slot
//    logged; step bonus when daily steps reach 12,500 (all or nothing); skipping a
//    scheduled day costs 20 points and resets the streak. Distance is never lost.
//  - Pause: paused days earn nothing and cost nothing; streak and totals are held.
//  - Daily steps never move you along the trail.
import * as db from './db.js?v=28';
import { isScheduledOn } from './program.js?v=28';

export const KM_PER_MI = 1.609344;
export const FT_PER_M = 3.28084;

export const TRAIL = {
  id: 'inca_classic',
  name: 'INCA TRAIL',
  totalKm: 44,
  gainM: 2860,
  highM: 4215,
  // Elevation profile. Altitudes from trek guides; km positions between
  // published points are approximate (no source gives every segment length).
  profile: [
    { km: 0,  m: 2700, label: 'START' },
    { km: 14, m: 3300 },
    { km: 19, m: 4215, label: '4,215 M', peak: true },
    { km: 21, m: 3600 },
    { km: 24, m: 3950, label: '3,950 M', peak: true },
    { km: 27, m: 3624 },
    { km: 30, m: 3700, peak: true },
    { km: 38, m: 2650 },
    { km: 44, m: 2430, label: 'MACHU PICCHU' },
  ],
  badges: [
    { id: 'first_mile',      name: 'FIRST MILE',        km: KM_PER_MI, icon: 'shoe' },
    { id: 'llactapata',      name: 'LLACTAPATA',        km: 10, icon: 'building-arch' },
    { id: 'ayapata',         name: 'AYAPATA CAMP',      km: 14, icon: 'tent' },
    { id: 'dead_womans_pass',name: "DEAD WOMAN'S PASS", km: 19, icon: 'mountain' },
    { id: 'runkurakay',      name: 'RUNKURAKAY PASS',   km: 24, icon: 'mountain' },
    { id: 'sayacmarca',      name: 'SAYACMARCA',        km: 27, icon: 'building-castle' },
    { id: 'phuyupatamarca',  name: 'PHUYUPATAMARCA',    km: 30, icon: 'trees' },
    { id: 'winay_wayna',     name: 'WIÑAY WAYNA',       km: 38, icon: 'building-arch' },
    { id: 'machu_picchu',    name: 'MACHU PICCHU',      complete: true, icon: 'sun' },
  ],
};

export const DEFAULT_CALIBRATION = [
  { incline: 0, bpm: 110 }, { incline: 4, bpm: 120 }, { incline: 8, bpm: 135 }, { incline: 12, bpm: 150 },
];
export const STRENGTH_CREDIT = 0.25;
export const STRENGTH_SPEED_MPH = 3.0;
export const WORKOUT_POINTS = 60;
export const MEAL_POINTS = 10;
export const SKIP_PENALTY = 20;
export const STEP_THRESHOLD = 12500;
export const DEFAULT_STEP_BONUS = 30;
const MULT_PER_DAY = 0.05;
const MULT_CAP = 1.5;

// ---------- pure helpers (testable) ----------
export function localIso(d) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return localIso(new Date(y, m - 1, d + n));
}
function dayKeyOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(y, m - 1, d).getDay()];
}

// Heart rate → treadmill grade (fraction). Below the lowest row: lowest row's incline
// if it's 0, else 0. Above the highest: capped at the highest incline (never extrapolated).
export function hrToGrade(bpm, table) {
  if (!bpm || !Array.isArray(table) || table.length === 0) return 0;
  const t = [...table].filter((r) => r.bpm > 0 && r.incline >= 0).sort((a, b) => a.bpm - b.bpm);
  if (t.length === 0) return 0;
  if (bpm < t[0].bpm) return 0;
  if (bpm >= t[t.length - 1].bpm) return t[t.length - 1].incline / 100;
  for (let i = 0; i < t.length - 1; i++) {
    const a = t[i], b = t[i + 1];
    if (bpm >= a.bpm && bpm <= b.bpm) {
      const f = b.bpm === a.bpm ? 0 : (bpm - a.bpm) / (b.bpm - a.bpm);
      return (a.incline + f * (b.incline - a.incline)) / 100;
    }
  }
  return 0;
}

// Distance (km) and climb (m) earned by one completed session.
export function sessionCredit(session, exById, cfg) {
  const { calibration = DEFAULT_CALIBRATION, stairStepHeightIn = null } = cfg || {};
  let distKm = 0, climbM = 0, cardioSec = 0, hasStrength = false;
  for (const ex of session.exercises || []) {
    const lib = exById.get(ex.exerciseId);
    const isCardio = lib?.category === 'cardio';
    for (const set of ex.sets || []) {
      if (!set.done) continue;
      if (!isCardio) { hasStrength = true; continue; }
      const machine = set.actualMachine || lib?.cardioMachine || 'other';
      const dur = set.actualDurationSec || 0;
      cardioSec += dur;
      if (machine === 'stairmaster') {
        if (set.actualStepsClimbed && stairStepHeightIn) climbM += set.actualStepsClimbed * stairStepHeightIn * 0.0254;
        continue;
      }
      const mi = set.actualDistanceMi != null ? set.actualDistanceMi
        : (set.actualSpeedMph && dur ? set.actualSpeedMph * dur / 3600 : 0);
      if (!mi) continue;
      let grade = 0;
      if (machine === 'treadmill') grade = (set.actualInclinePct || 0) / 100;
      else if (machine !== 'outdoor_run') grade = hrToGrade(set.actualAvgHr, calibration);
      distKm += mi * KM_PER_MI;
      climbM += mi * KM_PER_MI * 1000 * grade;
    }
  }
  if (hasStrength && session.strengthAvgHr && session.startedAt && session.completedAt) {
    const totalSec = (new Date(session.completedAt) - new Date(session.startedAt)) / 1000;
    const strengthSec = Math.max(0, totalSec - cardioSec);
    const mi = STRENGTH_SPEED_MPH * strengthSec / 3600;
    const grade = hrToGrade(session.strengthAvgHr, calibration);
    distKm += mi * KM_PER_MI * STRENGTH_CREDIT;
    climbM += mi * KM_PER_MI * 1000 * grade * STRENGTH_CREDIT;
  }
  return { distKm: Math.round(distKm * 1000) / 1000, climbM: Math.round(climbM * 10) / 10 };
}

export function isPaused(iso, pauses) {
  return (pauses || []).some((p) => p.start <= iso && (p.end == null || iso < p.end));
}

export function streakMultiplier(streak) {
  return Math.min(MULT_CAP, 1 + MULT_PER_DAY * streak);
}

// Walk every day from the start date to today and total everything up.
export function evaluate({ startDate, today, sessions, routines, meals, activity, pauses, ledger, stepBonus, legacySchedule }) {
  const byDay = new Map();
  for (const s of sessions || []) {
    if (s.isActive || !s.completedAt) continue;
    const d = localIso(s.completedAt);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(s);
  }
  const mealsByDay = new Map();
  for (const m of meals || []) {
    if (!m.date) continue;
    if (!mealsByDay.has(m.date)) mealsByDay.set(m.date, new Set());
    mealsByDay.get(m.date).add(m.meal || 'other');
  }
  const stepsByDay = new Map((activity || []).map((a) => [a.date, a.steps || 0]));

  let points = 0, streak = 0, distKm = 0, climbM = 0;
  const progress = []; // [{date, distKm, climbM}] cumulative, for badge dating
  if (!startDate) return { points, streak, multiplier: 1, distKm, climbM, progress, pausedToday: false };
  for (let d = startDate; d <= today; d = addDays(d, 1)) {
    if (isPaused(d, pauses)) continue;
    const daySessions = byDay.get(d) || [];
    if (daySessions.length > 0) {
      streak += 1;
      const mult = streakMultiplier(streak);
      for (const s of daySessions) {
        const all = (s.exercises || []).flatMap((ex) => ex.sets || []);
        const done = all.filter((st) => st.done).length;
        const frac = all.length > 0 ? done / all.length : 1;
        points += Math.round(WORKOUT_POINTS * frac * mult);
        const c = ledger?.[s.id];
        if (c) { distKm += c.distKm || 0; climbM += c.climbM || 0; }
      }
    } else if (d < today && ((legacySchedule && d < legacySchedule.until && (legacySchedule.days || []).includes(dayKeyOf(d)))
      || (routines || []).some((r) => isScheduledOn(r, d)))) {
      points = Math.max(0, points - SKIP_PENALTY);
      streak = 0;
    }
    points += Math.min(4, (mealsByDay.get(d) || new Set()).size) * MEAL_POINTS;
    if ((stepsByDay.get(d) || 0) >= STEP_THRESHOLD) points += stepBonus ?? DEFAULT_STEP_BONUS;
    progress.push({ date: d, distKm, climbM });
  }
  return {
    points, streak, multiplier: streakMultiplier(streak), distKm, climbM, progress,
    pausedToday: isPaused(today, pauses),
  };
}

// ---------- DB-backed API ----------
export async function getConfig() {
  const [startDate, calibration, pauses, stepBonus, stairStepHeightIn] = await Promise.all([
    db.getSetting('trailStartDate', null),
    db.getSetting('hrCalibration', DEFAULT_CALIBRATION),
    db.getSetting('trailPauses', []),
    db.getSetting('stepBonusPoints', DEFAULT_STEP_BONUS),
    db.getSetting('stairStepHeightIn', null),
  ]);
  return { startDate, calibration, pauses, stepBonus, stairStepHeightIn };
}

async function getLedger() {
  return (await db.get('meta', 'trailLedger'))?.value || {};
}

// Store credit for a session that was just saved (called from the finish flow).
export async function recordSession(session) {
  const cfg = await getConfig();
  if (!cfg.startDate || !session.completedAt) return null;
  const d = localIso(session.completedAt);
  if (d < cfg.startDate || isPaused(d, cfg.pauses)) return null;
  const exById = new Map((await db.getAll('exercises')).map((e) => [e.id, e]));
  const ledger = await getLedger();
  const credit = { ...sessionCredit(session, exById, cfg), computedAt: new Date().toISOString() };
  ledger[session.id] = credit;
  await db.put('meta', { key: 'trailLedger', value: ledger });
  return credit;
}

// Full status for HOME, the trail screen, and the header points pill.
export async function getStatus() {
  const cfg = await getConfig();
  const [sessions, routines, meals, activity, exercises] = await Promise.all([
    db.getAll('sessions'), db.getAll('routines'), db.getAll('mealLog'), db.getAll('dailyActivity'), db.getAll('exercises'),
  ]);
  const ledger = await getLedger();
  // Any completed session in the window without credit yet (e.g. edited dates) gets it now.
  let changed = false;
  if (cfg.startDate) {
    const exById = new Map(exercises.map((e) => [e.id, e]));
    for (const s of sessions) {
      if (s.isActive || !s.completedAt || ledger[s.id]) continue;
      const d = localIso(s.completedAt);
      if (d < cfg.startDate || isPaused(d, cfg.pauses)) continue;
      ledger[s.id] = { ...sessionCredit(s, exById, cfg), computedAt: new Date().toISOString() };
      changed = true;
    }
    if (changed) await db.put('meta', { key: 'trailLedger', value: ledger });
  }
  const today = localIso(new Date());
  const legacySchedule = await db.getSetting('legacySchedule', null);
  const ev = evaluate({ startDate: cfg.startDate, today, sessions, routines, meals, activity, pauses: cfg.pauses, ledger, stepBonus: cfg.stepBonus, legacySchedule });

  // Badges are stored once earned and never removed.
  const stored = (await db.get('meta', 'trailBadges'))?.value || {};
  let badgesChanged = false;
  for (const b of TRAIL.badges) {
    if (stored[b.id]) continue;
    const hit = ev.progress.find((p) => b.complete
      ? (p.distKm >= TRAIL.totalKm && p.climbM >= TRAIL.gainM)
      : p.distKm >= b.km);
    if (hit) { stored[b.id] = hit.date; badgesChanged = true; }
  }
  if (badgesChanged) await db.put('meta', { key: 'trailBadges', value: stored });

  const doneToday = sessions.some((s) => !s.isActive && s.completedAt && localIso(s.completedAt) === today);
  return {
    ...ev, today, doneToday, badges: stored, cfg,
    complete: ev.distKm >= TRAIL.totalKm && ev.climbM >= TRAIL.gainM,
  };
}

export async function setPaused(paused) {
  const pauses = [...(await db.getSetting('trailPauses', []))];
  const today = localIso(new Date());
  const open = pauses.find((p) => p.end == null);
  if (paused && !open) pauses.push({ start: today, end: null });
  if (!paused && open) {
    if (open.start === today) pauses.splice(pauses.indexOf(open), 1);
    else open.end = today;
  }
  await db.setSetting('trailPauses', pauses);
}

// ---------- formatting ----------
export const fmtMi = (km) => (km / KM_PER_MI).toFixed(1);
export const fmtFt = (m) => Math.round(m * FT_PER_M).toLocaleString();
