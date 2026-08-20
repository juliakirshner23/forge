// FORGE stats: weight trend + exercise progression + PRs
import * as db from './db.js?v=9';
import { el, section, formatDate } from './ui.js?v=9';

export async function renderStatsPage(container, params) {
  const [measurements, sessions, exercises] = await Promise.all([
    db.getAll('bodyMeasurements'), db.getAll('sessions'), db.getAll('exercises'),
  ]);
  const completedSessions = sessions.filter((s) => !s.isActive && s.completedAt);

  container.appendChild(el('section', { class: 'hero' }, [
    el('div', { class: 'eyebrow', text: `STATS  ·  ${completedSessions.length} SESSIONS  ·  ${measurements.length} MEASUREMENTS` }),
    el('h1', { text: 'PROGRESS' }),
  ]));

  // Weight chart
  const weightData = measurements
    .filter((m) => m.weight != null)
    .map((m) => ({ date: m.date, value: m.weight }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (weightData.length >= 2) {
    container.appendChild(section('WEIGHT (LB)', renderLineChart(weightData, { yLabel: 'LB' })));
  } else {
    container.appendChild(section('WEIGHT (LB)', el('div', { class: 'empty-note', text: 'NEED AT LEAST 2 WEIGHT ENTRIES' })));
  }

  // Exercise progression
  const exWithHistory = collectExerciseHistory(completedSessions, exercises);
  if (exWithHistory.length === 0) {
    container.appendChild(section('EXERCISE PROGRESSION', el('div', { class: 'empty-note', text: 'LOG A WORKOUT TO SEE PROGRESSION' })));
  } else {
    // Picker for exercise
    let selectedId = exWithHistory[0].id;
    const chartWrap = el('div', {});
    const picker = el('select', { class: 'form-input form-select' });
    for (const ex of exWithHistory) {
      const o = document.createElement('option');
      o.value = ex.id; o.textContent = `${ex.name} · ${ex.data.length} SESSIONS`;
      picker.appendChild(o);
    }
    picker.addEventListener('change', () => {
      selectedId = picker.value;
      renderExChart();
    });
    function renderExChart() {
      chartWrap.innerHTML = '';
      const ex = exWithHistory.find((e) => e.id === selectedId);
      if (!ex || ex.data.length < 1) return;
      chartWrap.appendChild(renderLineChart(ex.data, { yLabel: ex.unit || 'LB' }));
    }
    renderExChart();
    container.appendChild(section('EXERCISE PROGRESSION', el('div', {}, [
      el('div', { class: 'form-field' }, [ el('span', { class: 'form-label', text: 'EXERCISE' }), picker ]),
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
          el('div', { class: 'exercise-meta', text: `${pr.type.toUpperCase()} · ${pr.value}  ·  ${formatDate(pr.date)}` }),
        ]),
      ]));
    }
    container.appendChild(section(`PERSONAL BESTS  ·  ${allPRs.length}`, list));
  }
}

function collectExerciseHistory(sessions, exercises) {
  const exById = new Map(exercises.map((e) => [e.id, e]));
  const map = new Map(); // exerciseId -> { id, name, unit, data: [{ date, value }] }
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
    }
  }
  const result = [...map.values()].filter((e) => e.data.length >= 1);
  for (const e of result) e.data.sort((a, b) => a.date.localeCompare(b.date));
  result.sort((a, b) => b.data.length - a.data.length);
  return result;
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

// Simple SVG line chart
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
  // Add caption
  const caption = el('div', { class: 'chart-caption', text: `${data[data.length - 1].value} ${yLabel || ''}  ·  LATEST  (${data.length} POINTS)` });
  wrap.appendChild(caption);
  return wrap;
}
