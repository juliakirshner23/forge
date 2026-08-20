// =========================================================
// FORGE · Calorie tracking module (Phase 2d · v0.4.0)
// =========================================================
// Personal food library + meal log. No macros, no barcode.
// Exercise calories auto-computed from FORGE sessions via
// MET × body weight × duration; can be manually overridden.
// =========================================================

import * as db from './db.js?v=8';
import {
  el, section, formField, formSelect,
  toast, confirmModal, uid, esc, todayIso, formatDate, progressBar, progressColor,
} from './ui.js?v=8';

// ---------- Constants ----------

const MEALS = [
  { key: 'breakfast', label: 'BREAKFAST' },
  { key: 'lunch',     label: 'LUNCH' },
  { key: 'dinner',    label: 'DINNER' },
  { key: 'snacks',    label: 'SNACKS' },
];

// MET (metabolic equivalent) defaults per exercise category.
// Formula: kcal = MET × body_weight_kg × duration_hours
const MET_BY_CATEGORY = {
  strength: 5.0,
  cardio:   6.5,
  core:     3.5,
  mobility: 2.5,
  rehab:    3.0,
};
// Per-exercise override by name substring (case-insensitive).
// Checked first; falls back to category MET.
const MET_BY_NAME_HINT = [
  { match: 'stairmaster', met: 9.0 },
  { match: 'stair',       met: 8.0 },
  { match: 'incline walk',met: 8.0 },
  { match: 'treadmill',   met: 6.0 },
  { match: 'cycling',     met: 7.0 },
  { match: 'bike',        met: 7.0 },
  { match: 'elliptical',  met: 5.0 },
  { match: 'walk',        met: 3.8 },
  { match: 'run',         met: 9.0 },
  { match: 'row',         met: 7.0 },
];

const KG_PER_LB = 0.453592;

const DEFAULT_BUDGET = 2000;
const DEFAULT_NET_GOAL = 1800;

// ---------- Helpers ----------

function mealFromTimeOfDay() {
  const h = new Date().getHours();
  if (h < 11) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h < 20) return 'dinner';
  return 'snacks';
}

function metForExercise(libEx) {
  if (!libEx) return MET_BY_CATEGORY.strength;
  const name = (libEx.name || '').toLowerCase();
  for (const hint of MET_BY_NAME_HINT) {
    if (name.includes(hint.match)) return hint.met;
  }
  return MET_BY_CATEGORY[libEx.category] || MET_BY_CATEGORY.strength;
}

// Estimate exercise kcal for a session:
// - Duration = completedAt - startedAt (fallback: sum of set durations)
// - MET = weighted average of exercise METs in this session (by count)
function estimateSessionKcal(session, exerciseIndex, bodyWeightLb) {
  if (!session.startedAt || !session.completedAt) return 0;
  const durHours = (new Date(session.completedAt) - new Date(session.startedAt)) / 3600000;
  if (durHours <= 0) return 0;
  const kg = bodyWeightLb * KG_PER_LB;
  const exs = session.exercises || [];
  if (exs.length === 0) return 0;
  let totalMet = 0;
  for (const ex of exs) {
    const libEx = exerciseIndex.get(ex.exerciseId);
    totalMet += metForExercise(libEx);
  }
  const avgMet = totalMet / exs.length;
  return Math.round(avgMet * kg * durHours);
}

async function latestBodyWeightLb() {
  const measurements = await db.getAll('bodyMeasurements');
  const withWeight = measurements.filter((m) => m.weight != null);
  if (withWeight.length === 0) return 160; // sensible fallback if no measurements
  withWeight.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return withWeight[0].weight;
}

async function exerciseKcalForDate(dateIso, exerciseIndex, bodyWeightLb) {
  // Check manual override first
  const override = await db.get('dailyCalorieAdjustments', dateIso);
  if (override && override.exerciseCaloriesOverride != null) {
    return { kcal: override.exerciseCaloriesOverride, isOverride: true };
  }
  const sessions = await db.getAll('sessions');
  const daySessions = sessions.filter((s) => !s.isActive && s.completedAt && s.completedAt.slice(0, 10) === dateIso);
  let total = 0;
  for (const s of daySessions) total += estimateSessionKcal(s, exerciseIndex, bodyWeightLb);
  return { kcal: total, isOverride: false };
}

async function foodKcalForDate(dateIso) {
  const meals = await db.getAll('mealLog');
  return meals.filter((m) => m.date === dateIso).reduce((sum, m) => sum + (m.calories || 0), 0);
}

// ---------- FOOD (main screen) ----------

export async function renderFood(container, params) {
  const dateIso = (params && params[0]) || todayIso();
  return renderFoodDay(container, [dateIso]);
}

export async function renderFoodDay(container, params) {
  const dateIso = (params && params[0]) || todayIso();
  const [budget, netGoal, foods, meals, exercises, bodyWeightLb] = await Promise.all([
    db.getSetting('calorieBudget', DEFAULT_BUDGET),
    db.getSetting('netCalorieGoal', DEFAULT_NET_GOAL),
    db.getAll('foods'),
    db.getAll('mealLog'),
    db.getAll('exercises'),
    latestBodyWeightLb(),
  ]);
  const exerciseIndex = new Map(exercises.map((e) => [e.id, e]));
  const todayMeals = meals.filter((m) => m.date === dateIso);
  const foodKcal = todayMeals.reduce((sum, m) => sum + (m.calories || 0), 0);
  const { kcal: exKcal, isOverride } = await exerciseKcalForDate(dateIso, exerciseIndex, bodyWeightLb);
  const net = foodKcal - exKcal;

  const isToday = dateIso === todayIso();
  const prevDate = shiftDate(dateIso, -1);
  const nextDate = shiftDate(dateIso, 1);
  const canGoNext = new Date(nextDate) <= new Date(todayIso());

  // Hero + date nav
  container.appendChild(el('section', { class: 'hero' }, [
    el('div', { class: 'eyebrow', text: `FOOD  ·  ${isToday ? 'TODAY' : formatDate(dateIso)}` }),
    el('h1', { text: 'CALORIES' }),
    el('div', { class: 'food-date-nav' }, [
      el('a', { class: 'food-date-arrow', href: `#/food-day/${prevDate}`, text: '‹' }),
      el('span', { class: 'food-date-label', text: prettyDate(dateIso) }),
      canGoNext
        ? el('a', { class: 'food-date-arrow', href: `#/food-day/${nextDate}`, text: '›' })
        : el('span', { class: 'food-date-arrow food-date-arrow-disabled', text: '›' }),
    ]),
  ]));

  // Top numbers: Food In / Exercise Out / Net
  container.appendChild(section(null, el('div', { class: 'food-summary' }, [
    foodTile('FOOD IN', foodKcal, 'KCAL', 'var(--amber)'),
    foodTile('EXERCISE OUT', exKcal, isOverride ? 'KCAL · MANUAL' : 'KCAL · AUTO', 'var(--body)'),
    foodTile('NET', net, 'KCAL', net <= netGoal ? 'var(--green)' : 'var(--red)'),
  ])));

  // Progress bars
  const foodPct = budget > 0 ? (foodKcal / budget) * 100 : 0;
  const netPct = netGoal > 0 ? (net / netGoal) * 100 : 0;
  container.appendChild(section('TARGETS', el('div', { class: 'form-stack' }, [
    progressBar(foodPct, { label: `FOOD IN vs BUDGET (${budget})`, value: `${foodKcal} / ${budget}` }),
    progressBar(netPct, { label: `NET vs GOAL (${netGoal})`, value: `${net} / ${netGoal}` }),
  ])));

  // Meal sections
  const mealsWrap = el('div', { class: 'meal-stack' });
  for (const meal of MEALS) {
    const entries = todayMeals.filter((m) => m.meal === meal.key);
    const subtotal = entries.reduce((sum, m) => sum + (m.calories || 0), 0);
    mealsWrap.appendChild(renderMealBlock(meal, entries, subtotal, dateIso, foods));
  }
  container.appendChild(section('MEALS', mealsWrap));

  // Exercise override
  container.appendChild(section('EXERCISE CALORIES', renderExerciseAdjuster(dateIso, exKcal, isOverride)));

  // Chart
  container.appendChild(section('TREND', await renderCalorieChart(exerciseIndex, bodyWeightLb)));

  // Manage foods link
  container.appendChild(section('LIBRARY', el('div', { class: 'action-stack' }, [
    el('a', { class: 'btn btn-outline', href: '#/food-new' }, [
      el('span', { class: 'btn-title', text: '+ NEW FOOD' }),
      el('span', { class: 'btn-sub', text: 'ADD A CUSTOM FOOD TO YOUR LIBRARY' }),
    ]),
    el('button', { class: 'btn btn-outline', onclick: () => openFoodLibraryInspector() }, [
      el('span', { class: 'btn-title', text: `BROWSE FOODS · ${foods.length}` }),
      el('span', { class: 'btn-sub', text: 'VIEW · EDIT · DELETE' }),
    ]),
  ])));
}

function foodTile(label, value, sub, color) {
  return el('div', { class: 'food-tile' }, [
    el('span', { class: 'food-tile-label', text: label }),
    el('span', { class: 'food-tile-value', style: `color: ${color};`, text: String(value) }),
    el('span', { class: 'food-tile-sub', text: sub }),
  ]);
}

function renderMealBlock(meal, entries, subtotal, dateIso, foods) {
  const block = el('div', { class: 'meal-block' });
  block.appendChild(el('div', { class: 'meal-header' }, [
    el('span', { class: 'meal-title', text: meal.label }),
    el('span', { class: 'meal-subtotal', text: `${subtotal} KCAL` }),
  ]));

  // Add-food row (inline)
  block.appendChild(renderAddFoodRow(meal.key, dateIso, foods));

  // Entries list
  if (entries.length === 0) {
    block.appendChild(el('div', { class: 'meal-empty', text: 'NO ENTRIES' }));
  } else {
    const list = el('div', { class: 'meal-entry-list' });
    for (const entry of entries) list.appendChild(renderMealEntry(entry));
    block.appendChild(list);
  }
  return block;
}

function renderAddFoodRow(mealKey, dateIso, foods) {
  // Sort by last_used desc so recents float up
  const sorted = [...foods].sort((a, b) => (b.lastUsedAt || '').localeCompare(a.lastUsedAt || ''));

  const wrap = el('div', { class: 'add-food-row' });
  const searchInput = el('input', {
    class: 'form-input add-food-search',
    type: 'text', placeholder: 'SEARCH FOOD OR TYPE NEW...',
  });
  const qtyInput = el('input', {
    class: 'form-input add-food-qty',
    type: 'number', step: '0.1', placeholder: 'QTY', value: '1',
  });
  const suggestions = el('div', { class: 'add-food-suggestions' });
  let selectedFoodId = null;

  function renderSuggestions(query) {
    suggestions.innerHTML = '';
    const q = (query || '').trim().toLowerCase();
    let list;
    if (q.length === 0) list = sorted.slice(0, 6); // recents
    else list = sorted.filter((f) => (f.name || '').toLowerCase().includes(q)).slice(0, 8);
    if (list.length === 0) {
      suggestions.appendChild(el('div', { class: 'add-food-empty', text: q ? 'NO MATCH · SAVE AS NEW FOOD' : 'NO FOODS YET' }));
      return;
    }
    for (const f of list) {
      const chip = el('button', {
        class: 'add-food-chip' + (selectedFoodId === f.id ? ' add-food-chip-selected' : ''),
        onclick: () => {
          selectedFoodId = f.id;
          searchInput.value = f.name;
          renderSuggestions(f.name);
        },
      }, [
        el('span', { class: 'add-food-chip-name', text: f.name }),
        el('span', { class: 'add-food-chip-cal', text: `${f.caloriesPerServing} KCAL / ${f.servingUnit}` }),
      ]);
      suggestions.appendChild(chip);
    }
  }
  renderSuggestions('');

  searchInput.addEventListener('input', () => {
    selectedFoodId = null;
    renderSuggestions(searchInput.value);
  });

  const addBtn = el('button', {
    class: 'btn btn-primary add-food-btn',
    onclick: async () => {
      const query = searchInput.value.trim();
      const qty = Number(qtyInput.value) || 1;
      if (!query) { toast('ENTER A FOOD NAME', 'error'); return; }
      let food = selectedFoodId ? foods.find((f) => f.id === selectedFoodId) : null;
      if (!food) {
        // Try exact match by name (case-insensitive)
        food = foods.find((f) => (f.name || '').toLowerCase() === query.toLowerCase());
      }
      if (!food) {
        // Prompt for calories via modal-like flow: open the New Food screen prefilled.
        window.location.hash = `#/food-new/${encodeURIComponent(query)}/${dateIso}/${mealKey}/${qty}`;
        return;
      }
      await logMeal(food, qty, mealKey, dateIso);
    },
  }, [ el('span', { class: 'btn-title', text: 'ADD' }) ]);

  wrap.appendChild(el('div', { class: 'add-food-inputs' }, [ searchInput, qtyInput, addBtn ]));
  wrap.appendChild(suggestions);
  return wrap;
}

async function logMeal(food, qty, mealKey, dateIso) {
  try {
    const nowIso = new Date().toISOString();
    const entry = {
      id: uid('ml'),
      date: dateIso,
      meal: mealKey,
      foodId: food.id,
      foodName: food.name,
      servings: qty,
      servingUnit: food.servingUnit,
      calories: Math.round((food.caloriesPerServing || 0) * qty),
      loggedAt: nowIso,
    };
    await db.put('mealLog', entry);
    // Bump last_used on food
    await db.put('foods', {
      ...food,
      lastUsedAt: nowIso,
      useCount: (food.useCount || 0) + 1,
    });
    toast(`LOGGED · ${food.name} · ${entry.calories} KCAL`, 'ok');
    refresh();
  } catch (err) {
    console.error(err);
    toast('LOG FAILED · ' + err.message, 'error');
  }
}

function renderMealEntry(entry) {
  const row = el('div', { class: 'meal-entry' }, [
    el('div', { class: 'meal-entry-main' }, [
      el('div', { class: 'meal-entry-name', text: entry.foodName || '(unknown)' }),
      el('div', { class: 'meal-entry-meta', text: `${entry.servings} × ${entry.servingUnit || 'serving'}` }),
    ]),
    el('div', { class: 'meal-entry-cal', text: `${entry.calories} KCAL` }),
    el('button', {
      class: 'meal-entry-del',
      text: '×',
      onclick: () => {
        confirmModal('DELETE ENTRY?', `Remove ${entry.foodName} from your log?`, async () => {
          try {
            await db.remove('mealLog', entry.id);
            toast('DELETED', 'ok');
            refresh();
          } catch (err) { console.error(err); toast('DELETE FAILED', 'error'); }
        });
      },
    }),
  ]);
  return row;
}

function renderExerciseAdjuster(dateIso, currentKcal, isOverride) {
  const wrap = el('div', { class: 'form-stack' });
  wrap.appendChild(el('div', { class: 'exercise-adj-note', text: isOverride
    ? 'MANUAL OVERRIDE ACTIVE · CLEAR TO USE AUTO-ESTIMATE'
    : 'AUTO-ESTIMATED FROM YOUR LOGGED WORKOUTS. OVERRIDE IF NEEDED.' }));

  const input = el('input', {
    class: 'form-input', type: 'number', min: '0', step: '1',
    placeholder: 'KCAL', value: isOverride ? String(currentKcal) : '',
  });
  wrap.appendChild(el('label', { class: 'form-field' }, [
    el('span', { class: 'form-label', text: 'OVERRIDE EXERCISE CALORIES' }),
    input,
  ]));

  wrap.appendChild(el('div', { class: 'action-stack' }, [
    el('button', {
      class: 'btn btn-primary',
      onclick: async () => {
        const val = input.value.trim();
        if (!val) { toast('ENTER A NUMBER OR CLEAR TO USE AUTO', 'error'); return; }
        try {
          await db.put('dailyCalorieAdjustments', {
            date: dateIso,
            exerciseCaloriesOverride: Number(val),
            updatedAt: new Date().toISOString(),
          });
          toast(`OVERRIDE SAVED · ${val} KCAL`, 'ok');
          refresh();
        } catch (err) { console.error(err); toast('SAVE FAILED', 'error'); }
      },
    }, [ el('span', { class: 'btn-title', text: 'SAVE OVERRIDE' }) ]),
    isOverride ? el('button', {
      class: 'btn btn-outline',
      onclick: async () => {
        try {
          await db.remove('dailyCalorieAdjustments', dateIso);
          toast('CLEARED · USING AUTO ESTIMATE', 'ok');
          refresh();
        } catch (err) { console.error(err); toast('CLEAR FAILED', 'error'); }
      },
    }, [ el('span', { class: 'btn-title', text: 'CLEAR OVERRIDE' }) ]) : null,
  ]));
  return wrap;
}

// ---------- NEW FOOD ----------

export async function renderFoodNew(container, params) {
  const prefillName = params && params[0] ? decodeURIComponent(params[0]) : '';
  const returnDate = params && params[1] ? params[1] : null;
  const returnMeal = params && params[2] ? params[2] : null;
  const returnQty  = params && params[3] ? Number(params[3]) : 1;
  return renderFoodFormPage(container, null, { prefillName, returnDate, returnMeal, returnQty });
}

export async function renderFoodEdit(container, params) {
  const foodId = params && params[0];
  const existing = foodId ? await db.get('foods', foodId) : null;
  if (!existing) { window.location.hash = '#/food'; return; }
  return renderFoodFormPage(container, existing, {});
}

async function renderFoodFormPage(container, existing, opts) {
  const isEdit = !!existing;
  const model = isEdit ? { ...existing } : {
    id: uid('fd'),
    name: opts.prefillName || '',
    caloriesPerServing: '',
    servingUnit: '1 serving',
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    useCount: 0,
  };

  container.appendChild(el('section', { class: 'hero' }, [
    el('div', { class: 'eyebrow' }, [
      el('a', { href: opts.returnDate ? `#/food-day/${opts.returnDate}` : '#/food', class: 'crumb', text: '‹ FOOD' }),
      el('span', { text: '  ·  ' + (isEdit ? 'EDITING' : 'NEW FOOD') }),
    ]),
    el('h1', { text: isEdit ? 'EDIT FOOD' : 'NEW FOOD' }),
  ]));

  const form = el('div', { class: 'form-stack' });
  form.appendChild(formField('NAME', 'text', 'name', model.name, 'e.g. Greek Yogurt (1 cup)'));
  form.appendChild(formField('CALORIES PER SERVING', 'number', 'kcal', model.caloriesPerServing, 'e.g. 130'));
  form.appendChild(formField('SERVING UNIT', 'text', 'unit', model.servingUnit, 'e.g. 1 cup, 100g, 1 slice'));
  container.appendChild(section(null, form));

  const saveBtn = el('button', { class: 'btn btn-primary' }, [
    el('span', { class: 'btn-title', text: isEdit ? 'SAVE CHANGES' : 'CREATE FOOD' }),
    el('span', { class: 'btn-sub', text: isEdit ? 'UPDATE THIS FOOD' : (opts.returnDate ? 'ALSO LOGS IT TO YOUR MEAL' : 'ADDS TO YOUR LIBRARY') }),
  ]);
  saveBtn.addEventListener('click', async () => {
    const name = form.querySelector('[name="name"]').value.trim();
    const kcal = Number(form.querySelector('[name="kcal"]').value);
    const unit = form.querySelector('[name="unit"]').value.trim() || '1 serving';
    if (!name) { toast('NAME REQUIRED', 'error'); return; }
    if (!Number.isFinite(kcal) || kcal < 0) { toast('CALORIES MUST BE A NUMBER', 'error'); return; }
    const updated = {
      ...model,
      name, caloriesPerServing: Math.round(kcal), servingUnit: unit,
      updatedAt: new Date().toISOString(),
    };
    try {
      await db.put('foods', updated);
      toast(isEdit ? 'SAVED' : `CREATED · ${name}`, 'ok');
      if (!isEdit && opts.returnDate && opts.returnMeal) {
        await logMeal(updated, opts.returnQty || 1, opts.returnMeal, opts.returnDate);
        window.location.hash = `#/food-day/${opts.returnDate}`;
      } else {
        window.location.hash = '#/food';
      }
    } catch (err) { console.error(err); toast('SAVE FAILED · ' + err.message, 'error'); }
  });

  const actions = [saveBtn];
  if (isEdit) {
    actions.push(el('button', { class: 'btn btn-danger' }, [
      el('span', { class: 'btn-title', text: 'DELETE FOOD' }),
      el('span', { class: 'btn-sub', text: 'REMOVES FROM LIBRARY · MEAL ENTRIES KEPT' }),
    ]));
    actions[actions.length - 1].addEventListener('click', () => {
      confirmModal('DELETE FOOD?', `Remove "${model.name}" from your food library? Past meal entries stay logged.`, async () => {
        try {
          await db.remove('foods', model.id);
          toast('DELETED', 'ok');
          window.location.hash = '#/food';
        } catch (err) { console.error(err); toast('DELETE FAILED', 'error'); }
      });
    });
  }
  actions.push(el('a', {
    class: 'btn btn-outline',
    href: opts.returnDate ? `#/food-day/${opts.returnDate}` : '#/food',
  }, [
    el('span', { class: 'btn-title', text: 'CANCEL' }),
    el('span', { class: 'btn-sub', text: 'DISCARD' }),
  ]));
  container.appendChild(section('SAVE', el('div', { class: 'action-stack' }, actions)));
}

// ---------- Food library inspector ----------

async function openFoodLibraryInspector() {
  const foods = await db.getAll('foods');
  const sorted = [...foods].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  document.getElementById('inspector-title').textContent = `FOOD LIBRARY · ${sorted.length}`;
  const body = document.getElementById('inspector-body');
  body.innerHTML = '';
  if (sorted.length === 0) {
    body.innerHTML = `<div class="inspector-empty">NO FOODS YET · ADD ONE FROM THE FOOD SCREEN</div>`;
  } else {
    for (const f of sorted) {
      const div = document.createElement('div');
      div.className = 'inspector-item';
      div.innerHTML = `
        <div class="inspector-item-main">${esc(f.name)}</div>
        <div class="inspector-item-meta">${f.caloriesPerServing} KCAL / ${esc(f.servingUnit || '1 serving')} · USED ${f.useCount || 0}×</div>
        <a class="inspector-item-link" href="#/food-edit/${f.id}" onclick="document.getElementById('inspector-scrim').hidden=true;">EDIT ›</a>
      `;
      body.appendChild(div);
    }
  }
  document.getElementById('inspector-scrim').hidden = false;
}

// ---------- Chart (Food / Exercise / Net over time) ----------

async function renderCalorieChart(exerciseIndex, bodyWeightLb) {
  // Default 7-day view; user can toggle 30 / 90.
  const wrap = el('div', {});
  const chartWrap = el('div', {});
  const rangeBtns = el('div', { class: 'chart-range-row' });

  let range = 7;
  async function draw() {
    chartWrap.innerHTML = '';
    const days = await buildDailySeries(range, exerciseIndex, bodyWeightLb);
    chartWrap.appendChild(renderTripleLineChart(days));
  }
  for (const r of [7, 30, 90]) {
    const btn = el('button', {
      class: 'chart-range-btn' + (r === range ? ' chart-range-btn-active' : ''),
      text: `${r}D`,
      onclick: async () => {
        range = r;
        rangeBtns.querySelectorAll('.chart-range-btn').forEach((b) => b.classList.remove('chart-range-btn-active'));
        btn.classList.add('chart-range-btn-active');
        await draw();
      },
    });
    rangeBtns.appendChild(btn);
  }
  wrap.appendChild(rangeBtns);
  wrap.appendChild(chartWrap);
  await draw();
  return wrap;
}

async function buildDailySeries(nDays, exerciseIndex, bodyWeightLb) {
  const today = todayIso();
  const days = [];
  for (let i = nDays - 1; i >= 0; i--) days.push(shiftDate(today, -i));

  const [meals, sessions, adjustments] = await Promise.all([
    db.getAll('mealLog'), db.getAll('sessions'), db.getAll('dailyCalorieAdjustments'),
  ]);
  const adjMap = new Map(adjustments.map((a) => [a.date, a]));
  const foodByDate = new Map();
  for (const m of meals) foodByDate.set(m.date, (foodByDate.get(m.date) || 0) + (m.calories || 0));

  const sessionsByDate = new Map();
  for (const s of sessions) {
    if (s.isActive || !s.completedAt) continue;
    const d = s.completedAt.slice(0, 10);
    if (!sessionsByDate.has(d)) sessionsByDate.set(d, []);
    sessionsByDate.get(d).push(s);
  }

  const rows = [];
  for (const d of days) {
    const food = foodByDate.get(d) || 0;
    let ex = 0;
    const adj = adjMap.get(d);
    if (adj && adj.exerciseCaloriesOverride != null) {
      ex = adj.exerciseCaloriesOverride;
    } else {
      const daySessions = sessionsByDate.get(d) || [];
      for (const s of daySessions) ex += estimateSessionKcal(s, exerciseIndex, bodyWeightLb);
    }
    rows.push({ date: d, food, exercise: ex, net: food - ex });
  }
  return rows;
}

function renderTripleLineChart(rows) {
  if (rows.length === 0) return el('div', { class: 'empty-note', text: 'NO DATA' });
  const w = 340, h = 200, padL = 44, padR = 12, padT = 24, padB = 32;

  const allVals = rows.flatMap((r) => [r.food, r.exercise, r.net]);
  let minV = Math.min(...allVals, 0);
  let maxV = Math.max(...allVals, 100);
  const range = maxV - minV || 1;
  minV -= range * 0.08; maxV += range * 0.08;
  const yRange = maxV - minV || 1;

  const xStep = rows.length > 1 ? (w - padL - padR) / (rows.length - 1) : 0;

  function pts(key) {
    return rows.map((r, i) => ({
      x: padL + i * xStep,
      y: padT + (h - padT - padB) * (1 - (r[key] - minV) / yRange),
      v: r[key], date: r.date,
    }));
  }
  const foodPts = pts('food');
  const exPts = pts('exercise');
  const netPts = pts('net');

  function line(points, color, dashed) {
    return `<polyline fill="none" stroke="${color}" stroke-width="2" ${dashed ? 'stroke-dasharray="3 3"' : ''} points="${points.map((p) => `${p.x},${p.y}`).join(' ')}"/>` +
      points.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="2.5" fill="${color}"/>`).join('');
  }

  const svg = `<svg viewBox="0 0 ${w} ${h}" class="line-chart" xmlns="http://www.w3.org/2000/svg">
    <rect x="${padL}" y="${padT}" width="${w - padL - padR}" height="${h - padT - padB}" fill="none" stroke="#292524"/>
    ${[0, 0.25, 0.5, 0.75, 1].map((t) => {
      const y = padT + (h - padT - padB) * t;
      const val = Math.round(maxV - yRange * t);
      return `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="#171717" stroke-width="1"/>
              <text x="${padL - 6}" y="${y + 3}" fill="#57534e" font-size="9" text-anchor="end" font-family="monospace">${val}</text>`;
    }).join('')}
    ${line(foodPts, '#f59e0b', false)}
    ${line(exPts, '#a3a3a3', true)}
    ${line(netPts, '#fafafa', false)}
    <text x="${padL}" y="${padT - 8}" fill="#f59e0b" font-size="9" font-weight="900" font-family="monospace">■ FOOD</text>
    <text x="${padL + 66}" y="${padT - 8}" fill="#a3a3a3" font-size="9" font-weight="900" font-family="monospace">■ EXERCISE</text>
    <text x="${padL + 152}" y="${padT - 8}" fill="#fafafa" font-size="9" font-weight="900" font-family="monospace">■ NET</text>
    <text x="${padL}" y="${h - 8}" fill="#57534e" font-size="9" font-family="monospace">${rows[0].date}</text>
    <text x="${w - padR}" y="${h - 8}" fill="#57534e" font-size="9" text-anchor="end" font-family="monospace">${rows[rows.length - 1].date}</text>
  </svg>`;

  const wrap = document.createElement('div');
  wrap.className = 'chart-wrap';
  wrap.innerHTML = svg;

  // Caption: today's numbers
  const last = rows[rows.length - 1];
  const caption = el('div', { class: 'chart-caption', text: `TODAY · FOOD ${last.food} · EX ${last.exercise} · NET ${last.net}` });
  wrap.appendChild(caption);
  return wrap;
}

// ---------- Date helpers ----------

function shiftDate(iso, deltaDays) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function prettyDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
}

// ---------- Refresh helper ----------

async function refresh() {
  const m = await import('./app.js?v=8');
  m.refresh && m.refresh();
}
