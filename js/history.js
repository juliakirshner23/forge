// FORGE history: calendar heatmap + full session list + filter (v0.6.0)
import * as db from './db.js?v=13';
import { el, section, formatDate, DAY_LABELS, DAY_ORDER } from './ui.js?v=13';

export async function renderHistory(container) {
  const [allSessions, routines] = await Promise.all([db.getAll('sessions'), db.getAll('routines')]);
  const completed = allSessions
    .filter((s) => !s.isActive && s.completedAt)
    .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));

  container.appendChild(el('section', { class: 'hero' }, [
    el('div', { class: 'eyebrow' }, [
      el('a', { href: '#/me', class: 'crumb', text: '‹ ME' }),
      el('span', { text: `  ·  ${completed.length} SESSIONS` }),
    ]),
    el('h1', { text: 'HISTORY' }),
  ]));

  // Filter by routine
  const filterState = { routineId: 'all' };
  const filterWrap = el('div', { class: 'form-field' }, [
    el('span', { class: 'form-label', text: 'FILTER BY ROUTINE' }),
  ]);
  const select = el('select', { class: 'form-input form-select' });
  const allOpt = document.createElement('option');
  allOpt.value = 'all'; allOpt.textContent = `ALL · ${completed.length}`;
  select.appendChild(allOpt);
  const routineCounts = new Map();
  for (const s of completed) {
    routineCounts.set(s.routineId, (routineCounts.get(s.routineId) || 0) + 1);
  }
  for (const r of routines) {
    const n = routineCounts.get(r.id) || 0;
    if (n === 0) continue;
    const o = document.createElement('option');
    o.value = r.id; o.textContent = `${r.name} · ${n}`;
    select.appendChild(o);
  }
  filterWrap.appendChild(select);
  container.appendChild(section('FILTER', filterWrap));

  // Heatmap: last 12 weeks (always full data)
  container.appendChild(section('LAST 12 WEEKS', renderHeatmap(completed)));

  const listSection = el('div', {});
  container.appendChild(el('section', { class: 'section' }, [listSection]));

  function renderList() {
    listSection.innerHTML = '';
    const filtered = filterState.routineId === 'all' ? completed : completed.filter((s) => s.routineId === filterState.routineId);
    if (filtered.length === 0) {
      listSection.appendChild(el('div', { class: 'empty-note', text: 'NO SESSIONS MATCH' }));
      return;
    }
    const byMonth = new Map();
    for (const s of filtered) {
      const d = new Date(s.completedAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }).toUpperCase();
      if (!byMonth.has(key)) byMonth.set(key, { label, sessions: [] });
      byMonth.get(key).sessions.push(s);
    }
    for (const [, { label, sessions: monthSessions }] of byMonth) {
      const list = el('div', {});
      for (const s of monthSessions) list.appendChild(sessionRow(s));
      const wrap = section(`${label}  ·  ${monthSessions.length}`, list);
      listSection.appendChild(wrap);
    }
  }
  select.addEventListener('change', () => { filterState.routineId = select.value; renderList(); });
  renderList();
}

function sessionRow(s) {
  const setsCount = (s.exercises || []).reduce((n, ex) => n + (ex.sets || []).filter((st) => st.done).length, 0);
  const dur = s.startedAt && s.completedAt ? Math.round((new Date(s.completedAt) - new Date(s.startedAt)) / 60000) : null;
  const prCount = (s.prs || []).length;
  return el('a', { class: 'nav-row', href: `#/session/${s.id}` }, [
    el('div', { class: 'nav-row-main' }, [
      el('div', { class: 'nav-row-title', text: s.routineName || '(session)' }),
      el('div', { class: 'nav-row-sub', text: `${formatDate(s.completedAt)}  ·  ${setsCount} SETS${dur != null ? '  ·  ' + dur + ' MIN' : ''}${prCount ? '  ·  ★' + prCount : ''}` }),
    ]),
    el('div', { class: 'nav-row-arrow', text: '›' }),
  ]);
}

function renderHeatmap(sessions) {
  const now = new Date();
  const weeks = 12;
  const doneByDate = new Set();
  const setsByDate = new Map();
  for (const s of sessions) {
    const day = s.completedAt.slice(0, 10);
    doneByDate.add(day);
    const setCount = (s.exercises || []).reduce((n, ex) => n + (ex.sets || []).filter((st) => st.done).length, 0);
    setsByDate.set(day, (setsByDate.get(day) || 0) + setCount);
  }

  const grid = el('div', { class: 'heatmap' });
  // Column of day labels
  const labelCol = el('div', { class: 'heatmap-col heatmap-labels' });
  labelCol.appendChild(el('div', { class: 'heatmap-cell heatmap-cell-header' }));
  for (const d of DAY_ORDER) labelCol.appendChild(el('div', { class: 'heatmap-cell heatmap-cell-label', text: DAY_LABELS[d].slice(0, 1) }));
  grid.appendChild(labelCol);

  // Compute Monday of current week
  const dow = now.getDay();
  const daysSinceMon = (dow + 6) % 7;
  const thisMon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMon);

  for (let w = weeks - 1; w >= 0; w--) {
    const col = el('div', { class: 'heatmap-col' });
    const monOfWeek = new Date(thisMon.getFullYear(), thisMon.getMonth(), thisMon.getDate() - w * 7);
    // Header: month label if first week of month
    const monthLabel = monOfWeek.getDate() <= 7 ? monOfWeek.toLocaleDateString(undefined, { month: 'short' }).toUpperCase() : '';
    col.appendChild(el('div', { class: 'heatmap-cell heatmap-cell-header', text: monthLabel }));
    for (let i = 0; i < 7; i++) {
      const d = new Date(monOfWeek.getFullYear(), monOfWeek.getMonth(), monOfWeek.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      const isFuture = d > now;
      const done = doneByDate.has(iso);
      const sets = setsByDate.get(iso) || 0;
      let cls = 'heatmap-cell';
      if (isFuture) cls += ' heatmap-cell-future';
      else if (done) {
        cls += ' heatmap-cell-done';
        if (sets >= 20) cls += ' heatmap-cell-heavy';
        else if (sets >= 10) cls += ' heatmap-cell-medium';
      } else cls += ' heatmap-cell-empty';
      col.appendChild(el('div', { class: cls, title: `${iso} · ${sets} sets` }));
    }
    grid.appendChild(col);
  }
  return grid;
}
