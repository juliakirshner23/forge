// FORGE stats: weight trend + exercise progression + PRs + analytics (v0.6.0)
import * as db from './db.js?v=22';
import { el, section, formatDate } from './ui.js?v=22';
import { est1RM, strengthFocusShare, volumeTrend } from './progression.js?v=22';

const RANGES = [
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
  { label: '1Y',  days: 365 },
  { label: 'ALL', days: null },
];

export async function renderStatsPage(container, params) {
  const [measurements, sessions, exercises, routines] = await Promise.all([
    db.getAll('bodyMeasurements'), db.getAll('sessions'), db.getAll('exercises'), db.getAll('routines'),
  ]);
  const completedSessions = sessions.filter((s) => !s.isActive && s.completedAt);

  container.appendChild(el('section', { class: 'hero' }, [
    el('div', { class: 'eyebrow', text: `STATS  ·  ${completedSessions.length} SESSIONS  ·  ${measurements.length} MEASUREMENTS` }),
    el('h1', { text: 'PROGRESS' }),
  ]));

  // Strength focus share (last 30 days)
  const share = strengthFocusShare(completedSessions, exercises, 30);
  if (share) {
    container.appendChild(section('STRENGTH FOCUS · LAST 30 DAYS · % OF EXERCISES',
      renderFocusBars(share)));
  }

  // Body Measurements: individual chart per measurement, with range chips
  container.appendChild(await renderBodyMeasurementCharts(measurements));

  // Exercise progression
  const exWithHistory = collectExerciseHistory(completedSessions, exercises);
  if (exWithHistory.length === 0) {
    container.appendChild(section('EXERCISE PROGRESSION', el('div', { class: 'empty-note', text: 'LOG A WORKOUT TO SEE PROGRESSION' })));
  } else {
    let selectedId = exWithHistory[0].id;
    let selectedRangeIdx = 1; // default 90D
    const chartWrap = el('div', {});
    const rangeRow = el('div', { class: 'chart-range-row' });
    RANGES.forEach((r, i) => {
      const btn = el('button', {
        class: 'chart-range-btn' + (i === selectedRangeIdx ? ' chart-range-btn-active' : ''),
        text: r.label,
        onclick: () => {
          selectedRangeIdx = i;
          rangeRow.querySelectorAll('.chart-range-btn').forEach((b, bi) => b.classList.toggle('chart-range-btn-active', bi === i));
          renderExChart();
        },
      });
      rangeRow.appendChild(btn);
    });
    const picker = el('select', { class: 'form-input form-select' });
    for (const ex of exWithHistory) {
      const o = document.createElement('option');
      o.value = ex.id; o.textContent = `${ex.name} · ${ex.data.length} SESSIONS`;
      picker.appendChild(o);
    }
    picker.addEventListener('change', () => { selectedId = picker.value; renderExChart(); });

    function renderExChart() {
      chartWrap.innerHTML = '';
      const ex = exWithHistory.find((e) => e.id === selectedId);
      if (!ex || ex.data.length < 1) return;
      const days = RANGES[selectedRangeIdx].days;
      const filtered = days ? ex.data.filter((d) => (Date.now() - new Date(d.date).getTime()) <= days * 86400000) : ex.data;
      if (filtered.length === 0) {
        chartWrap.appendChild(el('div', { class: 'empty-note', text: 'NO DATA IN RANGE' }));
      } else {
        chartWrap.appendChild(renderLineChart(filtered, { yLabel: ex.unit || 'LB' }));
      }
      // Est. 1RM if strength
      if (ex.unit === 'LB' && ex.latestReps != null && ex.latestWeight != null) {
        const est = est1RM(ex.latestWeight, ex.latestReps);
        if (est != null) chartWrap.appendChild(el('div', { class: 'chart-caption', text: `EST 1RM · ${est} LB (FROM ${ex.latestWeight} × ${ex.latestReps})` }));
      }
      // Volume trend
      const trend = volumeTrend(ex.id, completedSessions.sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || '')));
      if (trend) {
        const arrow = trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '→';
        chartWrap.appendChild(el('div', { class: 'chart-caption', text: `VOLUME TREND · ${arrow} ${trend.pctChange > 0 ? '+' : ''}${trend.pctChange}% (2W vs PRIOR 2W)` }));
      }
    }
    renderExChart();
    container.appendChild(section('EXERCISE PROGRESSION', el('div', {}, [
      el('div', { class: 'form-field' }, [ el('span', { class: 'form-label', text: 'EXERCISE' }), picker ]),
      rangeRow,
      chartWrap,
    ])));
  }

  // Calorie trend chart (moved from FOOD in v0.7.8)
  container.appendChild(await renderCalorieTrendSection());

  // PRs list
  const allPRs = [];
  for (const s of completedSessions) {
    for (const pr of (s.prs || [])) {
      allPRs.push({ ...pr, date: s.completedAt });
    }
  }
  allPRs.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  if (allPRs.length > 0) {
    const list = el('div', { class: 'exercise-list' });
    for (const pr of allPRs.slice(0, 20)) {
      list.appendChild(el('div', { class: 'exercise-row' }, [
        el('div', { class: 'exercise-num', text: '★' }),
        el('div', { class: 'exercise-main' }, [
          el('div', { class: 'exercise-name', text: pr.exerciseName }),
          el('div', { class: 'exercise-meta', text: `${(pr.type || '').toUpperCase()} · ${pr.value}  ·  ${formatDate(pr.date)}` }),
        ]),
      ]));
    }
    container.appendChild(section(`PERSONAL BESTS  ·  ${allPRs.length}`, list));
  }
}

function collectExerciseHistory(sessions, exercises) {
  const exById = new Map(exercises.map((e) => [e.id, e]));
  const map = new Map();
  for (const s of sessions) {
    for (const ex of (s.exercises || [])) {
      const doneSets = (ex.sets || []).filter((st) => st.done);
      if (doneSets.length === 0) continue;
      const libEx = exById.get(ex.exerciseId);
      const isCardio = libEx?.category === 'cardio';
      const maxVal = isCardio
        ? Math.max(...doneSets.map((st) => st.actualDurationSec || 0)) / 60
        : Math.max(...doneSets.map((st) => (st.actualWeightLb || 0)));
      if (maxVal === 0) continue;
      if (!map.has(ex.exerciseId)) map.set(ex.exerciseId, {
        id: ex.exerciseId, name: ex.exerciseName,
        unit: isCardio ? 'MIN' : 'LB', data: [],
      });
      map.get(ex.exerciseId).data.push({ date: (s.completedAt || '').slice(0, 10), value: Math.round(maxVal * 10) / 10 });
      // Track latest reps + weight for 1RM
      if (!isCardio) {
        const topSet = doneSets.reduce((a, b) => (b.actualWeightLb || 0) > (a.actualWeightLb || 0) ? b : a, doneSets[0]);
        map.get(ex.exerciseId).latestReps = topSet.actualReps ?? null;
        map.get(ex.exerciseId).latestWeight = topSet.actualWeightLb ?? null;
      }
    }
  }
  const result = [...map.values()].filter((e) => e.data.length >= 1);
  for (const e of result) e.data.sort((a, b) => a.date.localeCompare(b.date));
  result.sort((a, b) => b.data.length - a.data.length);
  return result;
}

async function renderBodyMeasurementCharts(measurements) {
  const wrap = el('div', {});
  if (measurements.length < 2) {
    wrap.appendChild(el('div', { class: 'empty-note', text: 'NEED AT LEAST 2 MEASUREMENT ENTRIES' }));
    return section('BODY MEASUREMENTS', wrap);
  }
  const fields = [
    { key: 'weight', label: 'WEIGHT', unit: 'LB' },
    { key: 'waist',  label: 'WAIST',  unit: 'IN' },
    { key: 'hips',   label: 'HIPS',   unit: 'IN' },
    { key: 'chest',  label: 'CHEST',  unit: 'IN' },
    { key: 'neck',   label: 'NECK',   unit: 'IN' },
    { key: 'leftBicep',  label: 'L BICEP',  unit: 'IN' },
    { key: 'rightBicep', label: 'R BICEP',  unit: 'IN' },
    { key: 'leftThigh',  label: 'L THIGH',  unit: 'IN' },
    { key: 'rightThigh', label: 'R THIGH',  unit: 'IN' },
    { key: 'leftCalf',   label: 'L CALF',   unit: 'IN' },
    { key: 'rightCalf',  label: 'R CALF',   unit: 'IN' },
    { key: 'wrist',      label: 'WRIST',    unit: 'IN' },
  ];
  const available = fields.filter((f) => measurements.some((m) => m[f.key] != null));
  if (available.length === 0) {
    wrap.appendChild(el('div', { class: 'empty-note', text: 'NO MEASUREMENTS RECORDED' }));
    return section('BODY MEASUREMENTS', wrap);
  }
  let selectedKey = available[0].key;
  let selectedRangeIdx = 1;

  const picker = el('select', { class: 'form-input form-select' });
  for (const f of available) {
    const o = document.createElement('option');
    o.value = f.key; o.textContent = f.label;
    picker.appendChild(o);
  }
  const rangeRow = el('div', { class: 'chart-range-row' });
  const chartWrap = el('div', {});

  function draw() {
    chartWrap.innerHTML = '';
    const f = available.find((x) => x.key === selectedKey);
    const days = RANGES[selectedRangeIdx].days;
    const data = measurements
      .filter((m) => m[f.key] != null)
      .filter((m) => !days || (Date.now() - new Date(m.date + 'T00:00:00').getTime()) <= days * 86400000)
      .map((m) => ({ date: m.date, value: m[f.key] }))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (data.length < 2) {
      chartWrap.appendChild(el('div', { class: 'empty-note', text: 'NOT ENOUGH DATA IN RANGE' }));
    } else {
      chartWrap.appendChild(renderLineChart(data, { yLabel: f.unit }));
    }
  }
  RANGES.forEach((r, i) => {
    const btn = el('button', {
      class: 'chart-range-btn' + (i === selectedRangeIdx ? ' chart-range-btn-active' : ''),
      text: r.label,
      onclick: () => {
        selectedRangeIdx = i;
        rangeRow.querySelectorAll('.chart-range-btn').forEach((b, bi) => b.classList.toggle('chart-range-btn-active', bi === i));
        draw();
      },
    });
    rangeRow.appendChild(btn);
  });
  picker.addEventListener('change', () => { selectedKey = picker.value; draw(); });
  draw();
  wrap.appendChild(el('div', { class: 'form-field' }, [ el('span', { class: 'form-label', text: 'MEASUREMENT' }), picker ]));
  wrap.appendChild(rangeRow);
  wrap.appendChild(chartWrap);
  return section('BODY MEASUREMENTS', wrap);
}

function renderFocusBars(rows) {
  const wrap = el('div', { class: 'muscle-bars' });
  const colors = { push: 'var(--red)', pull: 'var(--blue-hi)', legs: 'var(--green)', core: 'var(--amber)' };
  const labels = { push: 'PUSH', pull: 'PULL', legs: 'LEGS', core: 'CORE' };
  const max = Math.max(...rows.map((r) => r.pct), 1);
  for (const r of rows) {
    const pctOfMax = (r.pct / max) * 100;
    wrap.appendChild(el('div', { class: 'muscle-bar-row' }, [
      el('span', { class: 'muscle-bar-label', text: labels[r.focus] }),
      el('div', { class: 'muscle-bar' }, [
        el('div', { class: 'muscle-bar-fill', style: `width:${pctOfMax}%;background:${colors[r.focus]};` }),
      ]),
      el('span', { class: 'muscle-bar-val', text: `${r.pct}% · ${r.count}` }),
    ]));
  }
  return wrap;
}

function weeklyVolumeCards(sessions) {
  const now = new Date();
  const dow = now.getDay();
  const daysSinceMon = (dow + 6) % 7;
  const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMon);
  const monIso = mon.toISOString().slice(0, 10);

  const thisWeek = sessions.filter((s) => s.completedAt && s.completedAt.slice(0, 10) >= monIso);
  const totalSets = thisWeek.reduce((n, s) => n + (s.exercises || []).reduce((m, ex) => m + (ex.sets || []).filter((st) => st.done).length, 0), 0);
  const totalMin = thisWeek.reduce((n, s) => {
    if (!s.completedAt || !s.startedAt) return n;
    return n + Math.round((new Date(s.completedAt) - new Date(s.startedAt)) / 60000);
  }, 0);

  return el('div', { class: 'stat-strip' }, [
    el('div', { class: 'stat-mini' }, [
      el('span', { class: 'stat-mini-label', text: 'SESSIONS' }),
      el('span', { class: 'stat-mini-value', text: thisWeek.length }),
      el('span', { class: 'stat-mini-sub', text: 'THIS WEEK' }),
    ]),
    el('div', { class: 'stat-mini' }, [
      el('span', { class: 'stat-mini-label', text: 'SETS' }),
      el('span', { class: 'stat-mini-value', text: totalSets }),
      el('span', { class: 'stat-mini-sub', text: 'TOTAL' }),
    ]),
    el('div', { class: 'stat-mini' }, [
      el('span', { class: 'stat-mini-label', text: 'MINUTES' }),
      el('span', { class: 'stat-mini-value', text: totalMin }),
      el('span', { class: 'stat-mini-sub', text: 'TRAINING' }),
    ]),
  ]);
}

function renderLineChart(data, { yLabel } = {}) {
  const w = 340, h = 180, padL = 44, padR = 12, padT = 16, padB = 28;
  const values = data.map((d) => d.value);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;
  const yMin = minV - range * 0.1;
  const yMax = maxV + range * 0.1;
  const yRange = yMax - yMin || 1;

  const xStep = data.length > 1 ? (w - padL - padR) / (data.length - 1) : 0;
  const pts = data.map((d, i) => ({
    x: padL + i * xStep,
    y: padT + (h - padT - padB) * (1 - (d.value - yMin) / yRange),
    v: d.value, date: d.date,
  }));

  const svg = `<svg viewBox="0 0 ${w} ${h}" class="line-chart" xmlns="http://www.w3.org/2000/svg">
    <rect x="${padL}" y="${padT}" width="${w - padL - padR}" height="${h - padT - padB}" fill="none" stroke="#292524"/>
    ${[0, 0.25, 0.5, 0.75, 1].map((t) => {
      const y = padT + (h - padT - padB) * t;
      const val = (yMax - yRange * t).toFixed(1);
      return `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="#171717" stroke-width="1"/>
              <text x="${padL - 6}" y="${y + 3}" fill="#57534e" font-size="9" text-anchor="end" font-family="monospace">${val}</text>`;
    }).join('')}
    <polyline fill="none" stroke="#f59e0b" stroke-width="2" points="${pts.map((p) => `${p.x},${p.y}`).join(' ')}"/>
    ${pts.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="3" fill="#f59e0b"/>`).join('')}
    <text x="${padL}" y="${h - 8}" fill="#57534e" font-size="9" font-family="monospace">${data[0].date}</text>
    <text x="${w - padR}" y="${h - 8}" fill="#57534e" font-size="9" text-anchor="end" font-family="monospace">${data[data.length - 1].date}</text>
    ${yLabel ? `<text x="6" y="${padT + 8}" fill="#a3a3a3" font-size="10" font-weight="900" font-family="monospace">${yLabel}</text>` : ''}
  </svg>`;

  const wrap = document.createElement('div');
  wrap.className = 'chart-wrap';
  wrap.innerHTML = svg;
  const caption = el('div', { class: 'chart-caption', text: `${data[data.length - 1].value} ${yLabel || ''}  ·  LATEST  (${data.length} POINTS)` });
  wrap.appendChild(caption);
  return wrap;
}

// v0.7.8 · Calorie trend chart (relocated from FOOD tab)
async function renderCalorieTrendSection() {
  const [meals, sessions, exercises, measurements, adjustments] = await Promise.all([
    db.getAll('mealLog'), db.getAll('sessions'), db.getAll('exercises'),
    db.getAll('bodyMeasurements'), db.getAll('dailyCalorieAdjustments'),
  ]);
  const bodyLb = (() => {
    const w = measurements.filter((m) => m.weight != null).sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
    return w?.weight ?? 160;
  })();
  const exById = new Map(exercises.map((e) => [e.id, e]));
  const MET_BY_NAME_HINT = [
    { m: 'stairmaster', met: 9.0 }, { m: 'stair', met: 8.0 },
    { m: 'incline walk', met: 8.0 }, { m: 'treadmill', met: 6.0 },
    { m: 'cycling', met: 7.0 }, { m: 'bike', met: 7.0 },
    { m: 'elliptical', met: 5.0 }, { m: 'walk', met: 3.8 },
    { m: 'run', met: 9.0 }, { m: 'row', met: 7.0 },
  ];
  const MET_BY_CATEGORY = { strength: 5.0, cardio: 6.5, core: 3.5, mobility: 2.5, rehab: 3.0 };
  const KG_PER_LB = 0.453592;
  const kg = bodyLb * KG_PER_LB;
  function metFor(libEx) {
    if (!libEx) return MET_BY_CATEGORY.strength;
    const n = (libEx.name || '').toLowerCase();
    for (const h of MET_BY_NAME_HINT) if (n.includes(h.m)) return h.met;
    return MET_BY_CATEGORY[libEx.category] || MET_BY_CATEGORY.strength;
  }
  const adjMap = new Map(adjustments.map((a) => [a.date, a]));

  const wrap = el('div', {});
  const rangeRow = el('div', { class: 'chart-range-row' });
  const chartWrap = el('div', {});
  let range = 7;
  for (const r of [7, 30, 90]) {
    const btn = el('button', {
      class: 'chart-range-btn' + (r === range ? ' chart-range-btn-active' : ''),
      text: `${r}D`,
      onclick: () => {
        range = r;
        rangeRow.querySelectorAll('.chart-range-btn').forEach((b) => b.classList.remove('chart-range-btn-active'));
        btn.classList.add('chart-range-btn-active');
        draw();
      },
    });
    rangeRow.appendChild(btn);
  }

  function shiftDate(iso, delta) {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    return d.toISOString().slice(0, 10);
  }
  function todayIsoLocal() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function buildSeries(days) {
    const today = todayIsoLocal();
    const dates = [];
    for (let i = days - 1; i >= 0; i--) dates.push(shiftDate(today, -i));
    const foodByDate = new Map();
    for (const m of meals) foodByDate.set(m.date, (foodByDate.get(m.date) || 0) + (m.calories || 0));
    const sessionsByDate = new Map();
    for (const s of sessions) {
      if (s.isActive || !s.completedAt) continue;
      const d = s.completedAt.slice(0, 10);
      if (!sessionsByDate.has(d)) sessionsByDate.set(d, []);
      sessionsByDate.get(d).push(s);
    }
    return dates.map((d) => {
      const food = foodByDate.get(d) || 0;
      let ex = 0;
      const adj = adjMap.get(d);
      if (adj && adj.exerciseCaloriesOverride != null) ex = adj.exerciseCaloriesOverride;
      else {
        for (const s of (sessionsByDate.get(d) || [])) {
          if (!s.startedAt) continue;
          const hours = (new Date(s.completedAt) - new Date(s.startedAt)) / 3600000;
          if (hours <= 0 || hours > 3) continue; // guard
          const exs = s.exercises || [];
          if (exs.length === 0) continue;
          const avgMet = exs.reduce((n, x) => n + metFor(exById.get(x.exerciseId)), 0) / exs.length;
          ex += Math.round(avgMet * kg * hours);
        }
      }
      return { date: d, food, exercise: ex, net: food - ex };
    });
  }
  function draw() {
    chartWrap.innerHTML = '';
    const rows = buildSeries(range);
    chartWrap.appendChild(renderTripleLine(rows));
  }
  wrap.appendChild(rangeRow);
  wrap.appendChild(chartWrap);
  draw();
  return section('CALORIE TREND · FOOD / EXERCISE / NET', wrap);
}

function renderTripleLine(rows) {
  if (rows.length === 0) return el('div', { class: 'empty-note', text: 'NO DATA' });
  const w = 340, h = 200, padL = 44, padR = 12, padT = 24, padB = 32;
  const allVals = rows.flatMap((r) => [r.food, r.exercise, r.net]);
  let minV = Math.min(...allVals, 0), maxV = Math.max(...allVals, 100);
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
  function line(points, color, dashed) {
    return `<polyline fill="none" stroke="${color}" stroke-width="2" ${dashed ? 'stroke-dasharray="3 3"' : ''} points="${points.map((p) => `${p.x},${p.y}`).join(' ')}"/>` +
      points.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="2.5" fill="${color}"/>`).join('');
  }
  const foodPts = pts('food'), exPts = pts('exercise'), netPts = pts('net');
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
  const last = rows[rows.length - 1];
  wrap.appendChild(el('div', { class: 'chart-caption', text: `TODAY · FOOD ${last.food} · EX ${last.exercise} · NET ${last.net}` }));
  return wrap;
}
