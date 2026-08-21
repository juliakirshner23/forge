// FORGE stats: weight trend + exercise progression + PRs + analytics (v0.6.0)
import * as db from './db.js?v=13';
import { el, section, formatDate } from './ui.js?v=13';
import { est1RM, muscleGroupVolume, cardioStrengthSplit, adherenceInWindow, volumeTrend } from './progression.js?v=13';

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

  // Adherence over 3 time windows
  const adherenceStrip = el('div', { class: 'stat-strip' });
  for (const win of [7, 30, 90]) {
    const pct = adherenceInWindow(routines, completedSessions, win);
    adherenceStrip.appendChild(el('div', { class: 'stat-mini' }, [
      el('span', { class: 'stat-mini-label', text: `${win}D` }),
      el('span', { class: 'stat-mini-value', text: pct != null ? `${pct}%` : '—' }),
      el('span', { class: 'stat-mini-sub', text: 'ADHERENCE' }),
    ]));
  }
  container.appendChild(section('ADHERENCE', adherenceStrip));

  // Cardio vs Strength time split
  const split = cardioStrengthSplit(completedSessions, exercises, 30);
  container.appendChild(section('CARDIO vs STRENGTH · LAST 30 DAYS',
    renderSplitBar(split.cardioMin, split.strengthMin)));

  // Muscle group balance
  const musc = muscleGroupVolume(completedSessions, exercises, 30);
  if (musc.size > 0) {
    container.appendChild(section('MUSCLE / CATEGORY BALANCE · LAST 30 DAYS', renderMuscleBars(musc)));
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

  // Volume this week
  container.appendChild(section('WEEKLY VOLUME', weeklyVolumeCards(completedSessions)));

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

function renderSplitBar(cardioMin, strengthMin) {
  const total = cardioMin + strengthMin || 1;
  const cardioPct = Math.round((cardioMin / total) * 100);
  const strengthPct = 100 - cardioPct;
  return el('div', { class: 'split-bar-wrap' }, [
    el('div', { class: 'split-bar-labels' }, [
      el('span', { class: 'split-bar-label split-bar-cardio', text: `CARDIO · ${cardioMin} MIN · ${cardioPct}%` }),
      el('span', { class: 'split-bar-label split-bar-strength', text: `STRENGTH · ${strengthMin} MIN · ${strengthPct}%` }),
    ]),
    el('div', { class: 'split-bar' }, [
      el('div', { class: 'split-bar-fill split-bar-fill-cardio', style: `width:${cardioPct}%;` }),
    ]),
  ]);
}

function renderMuscleBars(map) {
  const entries = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const max = entries[0][1] || 1;
  const wrap = el('div', { class: 'muscle-bars' });
  for (const [muscle, vol] of entries) {
    const pct = Math.round((vol / max) * 100);
    wrap.appendChild(el('div', { class: 'muscle-bar-row' }, [
      el('span', { class: 'muscle-bar-label', text: muscle.toUpperCase() }),
      el('div', { class: 'muscle-bar' }, [
        el('div', { class: 'muscle-bar-fill', style: `width:${pct}%;` }),
      ]),
      el('span', { class: 'muscle-bar-val', text: Math.round(vol) }),
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
