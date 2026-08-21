// =========================================================
// FORGE · Progression / analytics helpers (v0.6.0)
// =========================================================
// Pure functions: given data in, return insight out. No DOM.
// Consumed by: workout.js (PR detect on save), stats.js (1RM,
// muscle balance, cardio/strength split, volume trend), screens.js
// (weekly digest, progression prompts), goals.js (milestones,
// push-up ladder auto-advance).
// =========================================================

// --- 1 Rep Max estimate (Epley) ---
// Only meaningful for reps between 1 and 10 with real weight.
export function est1RM(weightLb, reps) {
  if (weightLb == null || reps == null || weightLb <= 0 || reps <= 0) return null;
  if (reps === 1) return Math.round(weightLb);
  if (reps > 12) return null; // Epley loses meaning past this
  return Math.round(weightLb * (1 + reps / 30));
}

// --- Detect new PRs in a just-completed session ---
// Compares this session's best set (weight, reps, weight*reps volume,
// duration for cardio) against all prior completed sessions.
// Returns array of { exerciseId, exerciseName, type, value, prev }.
export function detectPRs(session, priorSessions) {
  const prs = [];
  const byExercise = new Map();
  for (const s of priorSessions) {
    if (s.id === session.id) continue;
    if (s.isActive || !s.completedAt) continue;
    for (const ex of (s.exercises || [])) {
      if (!byExercise.has(ex.exerciseId)) byExercise.set(ex.exerciseId, { maxWeight: 0, maxReps: 0, maxVolume: 0, maxDuration: 0, maxDistance: 0 });
      const rec = byExercise.get(ex.exerciseId);
      for (const st of (ex.sets || [])) {
        if (!st.done) continue;
        if (st.actualWeightLb != null) rec.maxWeight = Math.max(rec.maxWeight, st.actualWeightLb);
        if (st.actualReps != null && st.actualWeightLb != null) {
          rec.maxVolume = Math.max(rec.maxVolume, st.actualWeightLb * st.actualReps);
        }
        if (st.actualReps != null && (st.actualWeightLb || 0) > 0 && st.actualWeightLb === rec.maxWeight) {
          rec.maxReps = Math.max(rec.maxReps, st.actualReps);
        }
        if (st.actualDurationSec != null) rec.maxDuration = Math.max(rec.maxDuration, st.actualDurationSec);
        if (st.actualDistanceMi != null) rec.maxDistance = Math.max(rec.maxDistance, st.actualDistanceMi);
      }
    }
  }
  // Now walk this session for PRs
  for (const ex of (session.exercises || [])) {
    const prev = byExercise.get(ex.exerciseId) || { maxWeight: 0, maxReps: 0, maxVolume: 0, maxDuration: 0, maxDistance: 0 };
    let bestWeight = 0, bestReps = 0, bestVolume = 0, bestDuration = 0, bestDistance = 0;
    for (const st of (ex.sets || [])) {
      if (!st.done) continue;
      if (st.actualWeightLb != null) bestWeight = Math.max(bestWeight, st.actualWeightLb);
      if (st.actualReps != null && st.actualWeightLb != null) bestVolume = Math.max(bestVolume, st.actualWeightLb * st.actualReps);
      if (st.actualReps != null) bestReps = Math.max(bestReps, st.actualReps);
      if (st.actualDurationSec != null) bestDuration = Math.max(bestDuration, st.actualDurationSec);
      if (st.actualDistanceMi != null) bestDistance = Math.max(bestDistance, st.actualDistanceMi);
    }
    if (bestWeight > prev.maxWeight && bestWeight > 0) {
      prs.push({ exerciseId: ex.exerciseId, exerciseName: ex.exerciseName, type: 'weight', value: `${bestWeight} LB`, prev: prev.maxWeight });
    }
    if (bestVolume > prev.maxVolume && bestVolume > 0) {
      prs.push({ exerciseId: ex.exerciseId, exerciseName: ex.exerciseName, type: 'volume', value: `${Math.round(bestVolume)} LB×REP`, prev: Math.round(prev.maxVolume) });
    }
    if (bestDistance > prev.maxDistance && bestDistance > 0) {
      prs.push({ exerciseId: ex.exerciseId, exerciseName: ex.exerciseName, type: 'distance', value: `${bestDistance} MI`, prev: prev.maxDistance });
    }
    if (bestDuration > prev.maxDuration && bestDuration > 0) {
      prs.push({ exerciseId: ex.exerciseId, exerciseName: ex.exerciseName, type: 'duration', value: `${Math.round(bestDuration / 60)} MIN`, prev: Math.round(prev.maxDuration / 60) });
    }
  }
  return prs;
}

// --- Progression suggestion for an exercise ---
// Given recent completed sessions with this exercise (newest first),
// suggests weight-up when clean sessions are strung together.
// sensitivity: 'aggressive' | 'balanced' | 'conservative'
export function suggestProgression(exerciseId, sessionsNewestFirst, sensitivity = 'balanced') {
  const threshold = sensitivity === 'aggressive' ? 1 : sensitivity === 'conservative' ? 3 : 2;
  const increment = 2.5; // lb
  const relevant = [];
  for (const s of sessionsNewestFirst) {
    const ex = (s.exercises || []).find((e) => e.exerciseId === exerciseId);
    if (!ex) continue;
    const done = (ex.sets || []).filter((st) => st.done && st.actualReps != null && st.actualWeightLb != null);
    if (done.length === 0) continue;
    const allHitPlan = done.every((st) => (st.plannedReps == null || st.actualReps >= st.plannedReps));
    const topWeight = Math.max(...done.map((st) => st.actualWeightLb));
    relevant.push({ date: s.completedAt, allHitPlan, topWeight });
    if (relevant.length >= threshold) break;
  }
  if (relevant.length < threshold) return null;
  const cleanStreak = relevant.every((r) => r.allHitPlan);
  if (!cleanStreak) return null;
  const currentTop = relevant[0].topWeight;
  return { action: 'increase', target: currentTop + increment, from: currentTop, reason: `HIT PLAN ${threshold}× IN A ROW` };
}

// --- Plateau detection ---
// Returns true if no strict PR (weight) on this exercise in the given window.
export function detectPlateau(exerciseId, sessionsNewestFirst, weeks = 4) {
  const cutoff = Date.now() - weeks * 7 * 86400000;
  let maxSeen = 0;
  let latestSeen = 0;
  let sawInWindow = false;
  for (const s of sessionsNewestFirst) {
    if (!s.completedAt) continue;
    const ex = (s.exercises || []).find((e) => e.exerciseId === exerciseId);
    if (!ex) continue;
    const done = (ex.sets || []).filter((st) => st.done && st.actualWeightLb != null);
    if (done.length === 0) continue;
    const top = Math.max(...done.map((st) => st.actualWeightLb));
    const inWindow = new Date(s.completedAt).getTime() >= cutoff;
    if (inWindow) { sawInWindow = true; latestSeen = Math.max(latestSeen, top); }
    maxSeen = Math.max(maxSeen, top);
  }
  return sawInWindow && latestSeen > 0 && latestSeen <= maxSeen && maxSeen > 0
    ? { plateaued: true, maxWeight: maxSeen, weeks }
    : null;
}

// --- Rotation suggestion ---
// If the user has done this exercise weekly for N weeks, suggest a swap.
export function detectRotation(exerciseId, sessionsNewestFirst, weeks = 8) {
  const cutoff = Date.now() - weeks * 7 * 86400000;
  const weeksHit = new Set();
  for (const s of sessionsNewestFirst) {
    if (!s.completedAt || new Date(s.completedAt).getTime() < cutoff) continue;
    const has = (s.exercises || []).some((e) => e.exerciseId === exerciseId);
    if (!has) continue;
    const d = new Date(s.completedAt);
    // ISO week number-ish (year * 100 + week)
    const week = Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 1).getTime()) / (7 * 86400000));
    weeksHit.add(d.getFullYear() * 100 + week);
  }
  return weeksHit.size >= weeks ? { weeksInARow: weeksHit.size } : null;
}

// --- Weight loss milestones ---
// Returns array of { lb, hit } from start toward goal in 5 lb steps up to 25, then 10 lb.
export function weightMilestones(startLb, currentLb, goalLb) {
  if (startLb == null || goalLb == null || startLb === goalLb) return [];
  const losing = goalLb < startLb;
  const totalDelta = Math.abs(startLb - goalLb);
  const stops = [];
  const smallSteps = [5, 10, 15, 20, 25];
  const bigStep = 10;
  for (const s of smallSteps) if (s <= totalDelta) stops.push(s);
  let n = 30;
  while (n <= totalDelta) { stops.push(n); n += bigStep; }
  if (!stops.includes(totalDelta)) stops.push(totalDelta);
  const doneDelta = losing ? Math.max(0, startLb - (currentLb ?? startLb)) : Math.max(0, (currentLb ?? startLb) - startLb);
  return stops.map((lb) => ({ lb, hit: doneDelta >= lb, remaining: Math.max(0, lb - doneDelta) }));
}

// --- Push-up ladder auto-advance criteria ---
// If the last N sessions logged this exercise with >= targetReps clean sets, advance.
export function shouldAdvancePushupPhase(exerciseId, sessionsNewestFirst, targetReps = 12, cleanSessions = 3) {
  let clean = 0;
  for (const s of sessionsNewestFirst) {
    const ex = (s.exercises || []).find((e) => e.exerciseId === exerciseId);
    if (!ex) continue;
    const done = (ex.sets || []).filter((st) => st.done && st.actualReps != null);
    if (done.length === 0) continue;
    if (done.length >= 3 && done.every((st) => st.actualReps >= targetReps)) clean++;
    else clean = 0;
    if (clean >= cleanSessions) return true;
    if (done.length > 0) break; // most recent counted, stop
  }
  return false;
}

// --- Volume trend for an exercise ---
// Compare avg volume in last 2 weeks vs prior 2 weeks.
// Returns { direction: 'up'|'flat'|'down', pctChange }
export function volumeTrend(exerciseId, sessionsNewestFirst) {
  const now = Date.now();
  const twoWeeks = 14 * 86400000;
  let recent = [], prior = [];
  for (const s of sessionsNewestFirst) {
    if (!s.completedAt) continue;
    const t = new Date(s.completedAt).getTime();
    const ex = (s.exercises || []).find((e) => e.exerciseId === exerciseId);
    if (!ex) continue;
    const vol = (ex.sets || []).filter((st) => st.done && st.actualReps != null && st.actualWeightLb != null)
      .reduce((n, st) => n + st.actualReps * st.actualWeightLb, 0);
    if (vol === 0) continue;
    if (t >= now - twoWeeks) recent.push(vol);
    else if (t >= now - 2 * twoWeeks) prior.push(vol);
  }
  if (recent.length === 0 || prior.length === 0) return null;
  const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const r = avg(recent), p = avg(prior);
  const pct = ((r - p) / p) * 100;
  return {
    direction: pct > 5 ? 'up' : pct < -5 ? 'down' : 'flat',
    pctChange: Math.round(pct),
  };
}

// --- Muscle group balance ---
// Given completed sessions and library exercises, returns {muscle: totalVolume}.
export function muscleGroupVolume(sessions, exercises, windowDays = 30) {
  const cutoff = Date.now() - windowDays * 86400000;
  const exById = new Map(exercises.map((e) => [e.id, e]));
  const byMuscle = new Map();
  for (const s of sessions) {
    if (s.isActive || !s.completedAt) continue;
    if (new Date(s.completedAt).getTime() < cutoff) continue;
    for (const ex of (s.exercises || [])) {
      const libEx = exById.get(ex.exerciseId);
      const muscles = libEx?.primaryMuscles && libEx.primaryMuscles.length
        ? libEx.primaryMuscles
        : [libEx?.category || 'other'];
      let vol = 0;
      for (const st of (ex.sets || [])) {
        if (!st.done) continue;
        if (st.actualReps != null && st.actualWeightLb != null) vol += st.actualReps * st.actualWeightLb;
        else if (st.actualReps != null) vol += st.actualReps;
      }
      if (vol === 0) continue;
      for (const m of muscles) {
        byMuscle.set(m, (byMuscle.get(m) || 0) + vol);
      }
    }
  }
  return byMuscle;
}

// --- Cardio vs Strength time split ---
export function cardioStrengthSplit(sessions, exercises, windowDays = 30) {
  const cutoff = Date.now() - windowDays * 86400000;
  const exById = new Map(exercises.map((e) => [e.id, e]));
  let cardioSec = 0, strengthSec = 0;
  for (const s of sessions) {
    if (s.isActive || !s.completedAt || !s.startedAt) continue;
    if (new Date(s.completedAt).getTime() < cutoff) continue;
    const total = (new Date(s.completedAt) - new Date(s.startedAt)) / 1000;
    // Split by exercise categories present, weighted by count
    let c = 0, o = 0;
    for (const ex of (s.exercises || [])) {
      const libEx = exById.get(ex.exerciseId);
      if (libEx?.category === 'cardio') c++;
      else o++;
    }
    if (c + o === 0) continue;
    cardioSec += total * (c / (c + o));
    strengthSec += total * (o / (c + o));
  }
  return { cardioMin: Math.round(cardioSec / 60), strengthMin: Math.round(strengthSec / 60) };
}

// --- Adherence for a window (0-100 %) ---
export function adherenceInWindow(routines, sessions, days) {
  const cutoff = Date.now() - days * 86400000;
  const active = routines.filter((r) => r.isActive !== false && r.scheduledDay);
  if (active.length === 0) return null;
  // How many scheduled workout occurrences in the window?
  let scheduled = 0, completed = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - i * 86400000);
    const key = ['sun','mon','tue','wed','thu','fri','sat'][d.getDay()];
    const iso = d.toISOString().slice(0,10);
    const anyToday = active.some((r) => r.scheduledDay === key);
    if (anyToday) scheduled++;
    const doneToday = sessions.some((s) => s.completedAt && s.completedAt.slice(0,10) === iso);
    if (anyToday && doneToday) completed++;
  }
  if (scheduled === 0) return null;
  return Math.round((completed / scheduled) * 100);
}
