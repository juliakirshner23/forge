// =========================================================
// FORGE · Hevy import
// =========================================================
// Reads a Hevy backup JSON and normalizes it into FORGE's
// data model. Handles kg → lb conversion (Hevy stores in kg).
// =========================================================

import * as db from './db.js?v=4';

const KG_TO_LB = 2.20462;

function uid() {
  return 'x_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function nowIso() {
  return new Date().toISOString();
}

// -------- Public: import from bundled seed file --------

export async function importBundledHevyBackup() {
  const res = await fetch('data/hevy-backup.json');
  if (!res.ok) throw new Error('Could not load bundled Hevy backup');
  const json = await res.json();
  return importHevyJson(json);
}

// -------- Public: import from user-provided JSON --------

export async function importHevyJson(json) {
  const summary = {
    exercises: 0,
    routines: 0,
    bodyMeasurements: 0,
    goals: 0,
    settings: 0,
    skipped: [],
  };

  // 1. Exercises
  const exercises = normalizeExercises(json);
  await db.putMany('exercises', exercises);
  summary.exercises = exercises.length;

  // 2. Routines
  const routines = normalizeRoutines(json);
  await db.putMany('routines', routines);
  summary.routines = routines.length;

  // 3. Body measurements
  const measurements = normalizeMeasurements(json);
  await db.putMany('bodyMeasurements', measurements);
  summary.bodyMeasurements = measurements.length;

  // 4. Goals (derived from user memory / constraints)
  const goals = normalizeGoals(json);
  await db.putMany('goals', goals);
  summary.goals = goals.length;

  // 5. Settings
  const settings = normalizeSettings(json);
  for (const s of settings) await db.setSetting(s.key, s.value);
  summary.settings = settings.length;

  // 6. Mark imported
  await db.put('meta', {
    key: 'lastImport',
    value: {
      source: json.export_metadata?.source || 'unknown',
      exportedAt: json.export_metadata?.exported_at || null,
      importedAt: nowIso(),
      summary,
    },
  });

  return summary;
}

// =========================================================
// NORMALIZERS
// =========================================================

function normalizeExercises(json) {
  const out = [];

  // Confirmed Hevy templates (built-in exercises she uses)
  const templates = json.confirmed_exercise_templates || {};
  for (const [hevyId, title] of Object.entries(templates)) {
    // Skip the "DO NOT USE" recumbent bike entry
    if (title.includes('DO NOT USE')) continue;

    out.push({
      id: 'hv_' + hevyId,
      name: title,
      category: categorizeExercise(title),
      primaryMuscles: [],
      secondaryMuscles: [],
      equipment: inferEquipment(title),
      isCustom: false,
      notes: '',
      substituteIds: [],
      constraintFlags: inferConstraints(title),
      hevyTemplateId: hevyId,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
  }

  // Custom user-created exercises
  const custom = json.custom_exercises || [];
  for (const ex of custom) {
    out.push({
      id: 'cu_' + ex.id,
      name: ex.title,
      category: categorizeExercise(ex.title),
      primaryMuscles: [],
      secondaryMuscles: [],
      equipment: inferEquipment(ex.title),
      isCustom: true,
      notes: ex.note || '',
      substituteIds: [],
      constraintFlags: inferConstraints(ex.title, ex.note),
      hevyTemplateId: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
  }

  return out;
}

function normalizeRoutines(json) {
  const out = [];
  const routines = json.routines || [];

  // Hevy's routine format is nested by folder in some exports. Normalize.
  const flat = Array.isArray(routines) ? routines : Object.values(routines).flat();

  for (const r of flat) {
    if (!r || !r.title) continue;
    out.push({
      id: 'rt_' + (r.id || uid()),
      name: r.title,
      folderId: r.folder_id || null,
      folderName: findFolderName(json, r.folder_id),
      scheduledDay: inferScheduledDay(r.title),
      focusTags: inferFocusTags(r.title),
      exercises: normalizeRoutineExercises(r.exercises || []),
      isActive: !r.title.toLowerCase().includes('legacy'),
      hevyId: r.id || null,
      notes: r.notes || '',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
  }

  return out;
}

function normalizeRoutineExercises(rawExercises) {
  return rawExercises.map((ex, idx) => {
    const templateId = ex.template_id || ex.exercise_template_id || null;
    const isCustom = templateId && templateId.length > 20; // UUIDs vs Hevy short IDs
    const prefix = isCustom ? 'cu_' : 'hv_';
    return {
      exerciseId: templateId ? prefix + templateId : 'unk_' + uid(),
      exerciseName: ex.title || ex.exercise_title || '(unknown)',
      order: idx,
      sets: (ex.sets || []).map((s, si) => normalizeSet(s, si)),
      restBetweenSets: ex.rest_seconds || null,
      supersetGroupId: ex.superset_id || null,
      notes: ex.notes || '',
      substituteIds: [],
    };
  });
}

function normalizeSet(s, index) {
  // Prefer pre-converted lb value if Hevy provides it; else convert from kg.
  let weightLb = null;
  if (s.weight_lb != null) weightLb = +(s.weight_lb).toFixed(1);
  else if (s.weight_kg != null) weightLb = +(s.weight_kg * KG_TO_LB).toFixed(1);

  let distanceMi = null;
  if (s.distance_mi != null) distanceMi = +(s.distance_mi).toFixed(2);
  else if (s.distance_meters != null) distanceMi = +(s.distance_meters / 1609.344).toFixed(2);

  return {
    order: index,
    type: s.type || s.set_type || 'normal', // 'normal' | 'warmup' | 'failure' | 'dropset'
    reps: s.reps ?? null,
    weightLb,
    durationSec: s.duration_seconds ?? null,
    distanceMeters: s.distance_meters ?? null,
    distanceMi,
  };
}

function normalizeMeasurements(json) {
  const out = [];
  const measurements = json.body_measurements || [];
  for (const m of measurements) {
    // Prefer explicit lb value; else convert from kg.
    let weightLb = null;
    if (m.weight_lb != null) weightLb = +(m.weight_lb).toFixed(1);
    else if (m.weight_kg != null) weightLb = +(m.weight_kg * KG_TO_LB).toFixed(1);
    out.push({
      id: 'bm_' + (m.id || m.date || uid()),
      date: m.date,
      weight: weightLb,
      waist: m.waist_cm != null ? +(m.waist_cm / 2.54).toFixed(1) : (m.waist_in || null),
      hips: m.hips_cm != null ? +(m.hips_cm / 2.54).toFixed(1) : (m.hips_in || null),
      chest: m.chest_cm != null ? +(m.chest_cm / 2.54).toFixed(1) : (m.chest_in || null),
      neck: m.neck_cm != null ? +(m.neck_cm / 2.54).toFixed(1) : (m.neck_in || null),
      leftBicep: m.left_bicep_in ?? null,
      rightBicep: m.right_bicep_in ?? null,
      leftThigh: m.left_thigh_in ?? null,
      rightThigh: m.right_thigh_in ?? null,
      leftCalf: m.left_calf_in ?? null,
      rightCalf: m.right_calf_in ?? null,
      wrist: m.wrist_in ?? null,
      units: 'imperial',
      notes: m.notes || '',
      createdAt: nowIso(),
    });
  }
  return out;
}

function normalizeGoals(json) {
  const out = [];

  // Explicit goals in file
  const goals = json.goals || [];
  for (const g of goals) {
    out.push({
      id: 'gl_' + (g.id || uid()),
      type: g.type || 'custom',
      title: g.title,
      targetValue: g.target_value ?? null,
      targetDate: g.target_date ?? null,
      currentValue: g.current_value ?? null,
      startValue: g.start_value ?? null,
      metadata: g.metadata || {},
      createdAt: nowIso(),
    });
  }

  // Seed the four known goals (Inca Trail, weight, push-ups, PT clearance)
  // unless the backup already provided one of the same type/id.
  const ctx = json.user_context || {};
  const seed = [
    {
      id: 'gl_inca_trail',
      type: 'event',
      title: 'Inca Trail',
      targetDate: ctx.inca_trail_date || '2027-04-19',
      metadata: { description: "Dead Woman's Pass · ~2,000 steps" },
    },
    {
      id: 'gl_weight',
      type: 'weight',
      title: 'Goal Weight',
      targetValue: ctx.weight_goal_lb || 170,
      targetDate: ctx.weight_goal_date || '2027-03-30',
      startValue: ctx.weight_start_lb || 266,
      metadata: { units: 'lb' },
    },
    {
      id: 'gl_pushup',
      type: 'pushup',
      title: '3 Full Push-Ups',
      targetDate: (ctx.pushup_goal && ctx.pushup_goal.target_date) || '2027-01-31',
      metadata: {
        phases: ['wall', 'high incline', 'mid incline', 'low incline', 'full'],
        currentPhaseIndex: 2,
      },
    },
    {
      id: 'gl_pt_clearance',
      type: 'clearance',
      title: 'PT Clearance · Unrestricted Lower Body',
      targetDate: (ctx.constraints && ctx.constraints.clearanceExpected) || '2027-09-01',
      metadata: { note: 'Full lower-body training resumes at this date' },
    },
  ];

  for (const s of seed) {
    if (!out.find((g) => g.id === s.id)) {
      out.push({ ...s, createdAt: nowIso() });
    }
  }

  return out;
}

function normalizeSettings(json) {
  const out = [];

  // Default units
  out.push({ key: 'units', value: { weight: 'lb', distance: 'mi', measurement: 'in' } });
  out.push({ key: 'strideLengthIn', value: 30 });
  out.push({ key: 'stepGoal', value: 10000 });
  out.push({ key: 'promptSensitivity', value: 'balanced' });
  out.push({ key: 'backupReminder', value: 'monthly' });

  // User profile
  const ctx = json.user_context || {};
  if (ctx.name || json.export_metadata?.user) {
    out.push({ key: 'profile', value: { name: ctx.name || json.export_metadata.user } });
  }

  // Injury constraints
  if (ctx.constraints) {
    out.push({ key: 'constraints', value: ctx.constraints });
  } else {
    // Default from user memory
    out.push({
      key: 'constraints',
      value: {
        active: true,
        summary: 'Leg injury · PT rehab only for lower body',
        flags: ['weight-bearing', 'plank', 'heavy-legs', 'standing-under-load'],
        clearanceExpected: '2027-09-01',
      },
    });
  }

  return out;
}

// =========================================================
// HEURISTICS  ·  fill in metadata Hevy doesn't provide
// =========================================================

function categorizeExercise(name) {
  const n = name.toLowerCase();
  if (/(elliptical|treadmill|cycling|stairmaster|air bike|recumbent|run|walk|bike|cardio)/.test(n)) return 'cardio';
  if (/(plank|crunch|leg raise|dead bug|russian twist|bicycle|reverse crunch|core|ab)/.test(n)) return 'core';
  if (/(clamshell|hip abduction|hip adduction|straight leg raise|hamstring bridge|glute bridge|long arc quad|physio ball)/.test(n)) return 'rehab';
  if (/(iyt|shoulder mobility|stretch|mobility|foam roll)/.test(n)) return 'mobility';
  return 'strength';
}

function inferEquipment(name) {
  const n = name.toLowerCase();
  if (/(dumbbell)/.test(n)) return 'Dumbbell';
  if (/(barbell)/.test(n)) return 'Barbell';
  if (/(cable)/.test(n)) return 'Cable';
  if (/(machine)/.test(n)) return 'Machine';
  if (/(band)/.test(n)) return 'Band';
  if (/(kettlebell)/.test(n)) return 'Kettlebell';
  if (/(elliptical|treadmill|stairmaster|bike|air bike)/.test(n)) return 'Cardio Machine';
  if (/(ball)/.test(n)) return 'Ball';
  return 'Bodyweight';
}

function inferConstraints(name, note = '') {
  const n = (name + ' ' + (note || '')).toLowerCase();
  const flags = [];
  if (/(plank)/.test(n)) flags.push('plank');
  if (/(squat|lunge|split squat|step[- ]?up|deadlift)/.test(n)) flags.push('heavy-legs');
  if (/(standing.+load|clean|jerk|snatch)/.test(n)) flags.push('standing-under-load');
  if (note && /not in use/i.test(note)) flags.push('user-disabled');
  return flags;
}

function inferScheduledDay(title) {
  const t = title.toLowerCase();
  if (/monday|\bmon\b/.test(t)) return 'mon';
  if (/tuesday|\btue\b/.test(t)) return 'tue';
  if (/wednesday|\bwed\b/.test(t)) return 'wed';
  if (/thursday|\bthu\b/.test(t)) return 'thu';
  if (/friday|\bfri\b/.test(t)) return 'fri';
  if (/saturday|\bsat\b/.test(t)) return 'sat';
  if (/sunday|\bsun\b/.test(t)) return 'sun';
  return null;
}

function inferFocusTags(title) {
  const t = title.toLowerCase();
  const tags = [];
  if (/push/.test(t)) tags.push('push');
  if (/pull/.test(t)) tags.push('pull');
  if (/leg/.test(t)) tags.push('legs');
  if (/upper/.test(t)) tags.push('upper');
  if (/core/.test(t)) tags.push('core');
  if (/rehab/.test(t)) tags.push('rehab');
  if (/cardio/.test(t)) tags.push('cardio');
  if (/recovery/.test(t)) tags.push('recovery');
  return tags;
}

function findFolderName(json, folderId) {
  if (!folderId) return null;
  const folder = (json.folders || []).find((f) => f.id === folderId);
  return folder ? folder.title : null;
}
