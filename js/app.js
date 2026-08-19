// =========================================================
// FORGE · Main app entry
// =========================================================

import * as db from './db.js';
import { importBundledHevyBackup } from './import.js';
import { downloadBackup, restoreFromBackupJson } from './export.js';

// -------- Service worker: NONE for now --------
// Earlier versions registered a caching SW that made updates painful.
// The current sw.js is a self-destruct that clears itself; if it's
// still installed on this device, its next activation will clean up.
// Offline caching returns in a later phase.

// -------- App boot --------

async function boot() {
  try {
    await db.openDb();
    await ensureSeedData();
    await renderStatus();
    await renderSettings();
    await renderStorageInfo();
    wireEvents();
  } catch (err) {
    console.error('Boot failed:', err);
    toast('BOOT FAILED · ' + (err.message || 'UNKNOWN'), 'error');
  }
}

async function ensureSeedData() {
  const meta = await db.get('meta', 'lastImport');
  if (meta) return; // Already imported at least once

  // First launch: import bundled Hevy backup
  toast('IMPORTING YOUR HEVY DATA...', 'ok');
  const summary = await importBundledHevyBackup();
  toast(`IMPORTED · ${summary.exercises} EX · ${summary.routines} ROUTINES · ${summary.bodyMeasurements} MEASUREMENTS`, 'ok', 3500);
}

// -------- Status grid --------

async function renderStatus() {
  const [exCount, rtCount, sessCount, bmCount, daCount, goalCount] = await Promise.all([
    db.count('exercises'),
    db.count('routines'),
    db.count('sessions'),
    db.count('bodyMeasurements'),
    db.count('dailyActivity'),
    db.count('goals'),
  ]);

  const meta = await db.get('meta', 'lastImport');
  const lastImport = meta?.value?.importedAt ? new Date(meta.value.importedAt) : null;

  const grid = document.getElementById('status-grid');
  grid.innerHTML = '';

  const cards = [
    { store: 'exercises',        label: 'EXERCISES',        value: exCount,   sub: 'IN LIBRARY',      highlight: true },
    { store: 'routines',         label: 'ROUTINES',         value: rtCount,   sub: 'ALL PROGRAMS' },
    { store: 'bodyMeasurements', label: 'MEASUREMENTS',     value: bmCount,   sub: 'BODY LOG' },
    { store: 'sessions',         label: 'SESSIONS',         value: sessCount, sub: 'WORKOUTS LOGGED' },
    { store: 'goals',            label: 'GOALS',            value: goalCount, sub: 'TRACKED' },
    { store: 'dailyActivity',    label: 'DAILY ACTIVITY',   value: daCount,   sub: 'DAYS LOGGED' },
  ];

  for (const c of cards) {
    const el = document.createElement('div');
    el.className = 'stat-card';
    if (c.highlight) el.setAttribute('data-highlight', '');
    if (c.value > 0) {
      el.setAttribute('data-tappable', '');
      el.addEventListener('click', () => openInspector(c.store, c.label));
    }
    el.innerHTML = `
      <span class="stat-label">${c.label}</span>
      <div>
        <div class="stat-value">${c.value}</div>
        <div class="stat-sub">${c.sub}</div>
      </div>`;
    grid.appendChild(el);
  }

  // Topbar meta line
  const topbarMeta = document.getElementById('topbar-meta');
  if (lastImport) {
    const days = Math.floor((Date.now() - lastImport.getTime()) / 86400000);
    topbarMeta.textContent = `LAST IMPORT · ${days}D AGO`;
  }
}

async function renderStorageInfo() {
  const el = document.getElementById('storage-info');
  const est = await db.storageEstimate();
  if (!est) {
    el.textContent = 'ESTIMATE UNAVAILABLE';
    return;
  }
  const usedMb = (est.usage / 1024 / 1024).toFixed(2);
  const quotaMb = (est.quota / 1024 / 1024).toFixed(0);
  const pct = ((est.usage / est.quota) * 100).toFixed(2);
  el.textContent = `${usedMb} MB USED · ${quotaMb} MB AVAILABLE · ${pct}%`;
}

// -------- Settings preview --------

async function renderSettings() {
  const box = document.getElementById('settings-preview');
  box.innerHTML = '';

  const [units, stride, stepGoal, prompts, backup, profile, constraints] = await Promise.all([
    db.getSetting('units'),
    db.getSetting('strideLengthIn'),
    db.getSetting('stepGoal'),
    db.getSetting('promptSensitivity'),
    db.getSetting('backupReminder'),
    db.getSetting('profile'),
    db.getSetting('constraints'),
  ]);

  const rows = [];
  if (profile?.name) rows.push({ key: 'PROFILE', value: profile.name });
  if (units) rows.push({ key: 'UNITS', value: `${units.weight?.toUpperCase() || '?'} · ${units.distance?.toUpperCase() || '?'} · ${units.measurement?.toUpperCase() || '?'}` });
  if (stride != null) rows.push({ key: 'STRIDE LENGTH', value: `${stride} IN` });
  if (stepGoal != null) rows.push({ key: 'DAILY STEP GOAL', value: stepGoal.toLocaleString() });
  if (prompts) rows.push({ key: 'PROMPT SENSITIVITY', value: prompts.toUpperCase() });
  if (backup) rows.push({ key: 'BACKUP REMINDER', value: backup.toUpperCase() });
  if (constraints) {
    rows.push({
      key: 'CONSTRAINTS',
      value: constraints.summary || (constraints.active ? 'ACTIVE' : 'NONE'),
      warn: constraints.active === true,
    });
    if (constraints.clearanceExpected) {
      rows.push({ key: 'PT CLEARANCE', value: constraints.clearanceExpected });
    }
  }

  if (rows.length === 0) {
    box.innerHTML = `<div class="settings-row"><span class="settings-key">NO SETTINGS SAVED</span></div>`;
    return;
  }

  for (const r of rows) {
    const el = document.createElement('div');
    el.className = 'settings-row';
    el.innerHTML = `
      <span class="settings-key">${r.key}</span>
      <span class="settings-value${r.warn ? ' settings-value-warn' : ''}">${r.value}</span>`;
    box.appendChild(el);
  }
}

// -------- Inspector modal --------

async function openInspector(store, label) {
  const rows = await db.getAll(store);
  const title = `${label} · ${rows.length}`;
  document.getElementById('inspector-title').textContent = title;

  const body = document.getElementById('inspector-body');
  body.innerHTML = '';

  if (rows.length === 0) {
    body.innerHTML = `<div class="inspector-empty">EMPTY</div>`;
  } else {
    const renderer = INSPECTOR_RENDERERS[store] || renderGenericItem;
    // Sort sensibly per store
    const sorted = INSPECTOR_SORTERS[store] ? [...rows].sort(INSPECTOR_SORTERS[store]) : rows;
    for (const row of sorted) {
      const el = document.createElement('div');
      el.className = 'inspector-item';
      el.innerHTML = renderer(row);
      body.appendChild(el);
    }
  }

  document.getElementById('inspector-scrim').hidden = false;
}

function hideInspector() {
  document.getElementById('inspector-scrim').hidden = true;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const INSPECTOR_RENDERERS = {
  exercises: (r) => `
    <div class="inspector-item-main">
      <span class="inspector-category cat-${r.category || 'strength'}">${(r.category || 'STR').toUpperCase().slice(0, 4)}</span>
      ${esc(r.name)}${r.isCustom ? ' <span class="inspector-item-meta">· CUSTOM</span>' : ''}
    </div>
    <div class="inspector-item-meta">${esc(r.equipment || '')}</div>`,
  routines: (r) => `
    <div class="inspector-item-main">${esc(r.name)}${r.folderName ? ` <span class="inspector-item-meta">· ${esc(r.folderName)}</span>` : ''}</div>
    <div class="inspector-item-meta">${(r.exercises || []).length} EX</div>`,
  bodyMeasurements: (r) => `
    <div class="inspector-item-main">${esc(r.date)}</div>
    <div class="inspector-item-meta">${r.weight != null ? r.weight + ' LB' : '—'}</div>`,
  sessions: (r) => `
    <div class="inspector-item-main">${esc(r.routineName || r.name || '(session)')}</div>
    <div class="inspector-item-meta">${(r.completedAt || r.startedAt || '').slice(0, 10)}</div>`,
  goals: (r) => `
    <div class="inspector-item-main">${esc(r.title)}${r.type ? ` <span class="inspector-item-meta">· ${esc(r.type.toUpperCase())}</span>` : ''}</div>
    <div class="inspector-item-meta">${r.targetDate ? esc(r.targetDate) : (r.targetValue != null ? r.targetValue : '')}</div>`,
  dailyActivity: (r) => `
    <div class="inspector-item-main">${esc(r.date)}</div>
    <div class="inspector-item-meta">${r.steps != null ? r.steps.toLocaleString() + ' STEPS' : '—'}</div>`,
};

function renderGenericItem(r) {
  const key = r.id || r.date || r.key || '(no id)';
  return `<div class="inspector-item-main">${esc(key)}</div>`;
}

const INSPECTOR_SORTERS = {
  bodyMeasurements: (a, b) => (b.date || '').localeCompare(a.date || ''), // newest first
  dailyActivity:    (a, b) => (b.date || '').localeCompare(a.date || ''),
  exercises:        (a, b) => (a.name || '').localeCompare(b.name || ''),
  routines:         (a, b) => (a.name || '').localeCompare(b.name || ''),
  goals:            (a, b) => (a.targetDate || '').localeCompare(b.targetDate || ''),
  sessions:         (a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''),
};

// -------- Event wiring --------

function wireEvents() {
  document.getElementById('btn-export').addEventListener('click', onExport);
  document.getElementById('btn-import').addEventListener('click', onImportClick);
  document.getElementById('file-input').addEventListener('change', onFileChosen);
  document.getElementById('btn-clear').addEventListener('click', onClearClick);
  document.getElementById('btn-reimport').addEventListener('click', onReimportClick);
  document.getElementById('modal-cancel').addEventListener('click', hideModal);
  document.getElementById('inspector-close').addEventListener('click', hideInspector);
  // Tap outside modal to dismiss
  document.getElementById('inspector-scrim').addEventListener('click', (e) => {
    if (e.target.id === 'inspector-scrim') hideInspector();
  });
}

async function onExport() {
  try {
    const result = await downloadBackup();
    const kb = (result.size / 1024).toFixed(1);
    toast(`EXPORTED · ${result.filename} · ${kb} KB`, 'ok');
  } catch (err) {
    console.error(err);
    toast('EXPORT FAILED · ' + err.message, 'error');
  }
}

function onImportClick() {
  document.getElementById('file-input').click();
}

async function onFileChosen(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = ''; // reset so same file can be re-selected

  try {
    const text = await file.text();
    const json = JSON.parse(text);

    // Detect format: FORGE backup vs Hevy backup
    const isForgeBackup = json.export_metadata?.app === 'FORGE';
    const label = isForgeBackup ? 'FORGE backup' : 'Hevy backup';

    confirmModal(
      `RESTORE FROM ${label.toUpperCase()}?`,
      `This wipes current data and replaces it with the file's contents. Cannot be undone.`,
      async () => {
        try {
          let summary;
          if (isForgeBackup) {
            summary = await restoreFromBackupJson(json);
          } else {
            // Assume Hevy format
            await db.clearAll();
            const { importHevyJson } = await import('./import.js');
            summary = await importHevyJson(json);
          }
          await renderStatus();
          await renderSettings();
          await renderStorageInfo();
          const total = Object.values(summary).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
          toast(`RESTORED · ${total} ITEMS`, 'ok', 3500);
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

function onClearClick() {
  confirmModal(
    'CLEAR ALL DATA?',
    'This wipes every exercise, routine, session, measurement, and setting from this device. If you have no backup, this data is gone. Export first.',
    async () => {
      try {
        await db.clearAll();
        await renderStatus();
        await renderSettings();
        await renderStorageInfo();
        toast('DATA CLEARED', 'ok');
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
    'Wipes current data and reloads the app\'s bundled Hevy seed file. Use only if you want to reset to the original seed.',
    async () => {
      try {
        await db.clearAll();
        const summary = await importBundledHevyBackup();
        await renderStatus();
        await renderSettings();
        await renderStorageInfo();
        toast(`REIMPORTED · ${summary.exercises} EX · ${summary.routines} ROUTINES`, 'ok', 3500);
      } catch (err) {
        console.error(err);
        toast('RE-IMPORT FAILED · ' + err.message, 'error');
      }
    }
  );
}

// -------- Toast --------

let toastTimer = null;
function toast(msg, kind = '', duration = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show ' + (kind === 'ok' ? 'toast-ok' : kind === 'error' ? 'toast-error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = 'toast ' + (kind === 'ok' ? 'toast-ok' : kind === 'error' ? 'toast-error' : '');
  }, duration);
}

// -------- Modal --------

let modalOnConfirm = null;
function confirmModal(title, body, onConfirm) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').textContent = body;
  document.getElementById('modal-scrim').hidden = false;
  modalOnConfirm = onConfirm;

  const confirmBtn = document.getElementById('modal-confirm');
  // Rewire to avoid stacking listeners
  const fresh = confirmBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(fresh, confirmBtn);
  fresh.addEventListener('click', async () => {
    hideModal();
    if (modalOnConfirm) await modalOnConfirm();
    modalOnConfirm = null;
  });
}

function hideModal() {
  document.getElementById('modal-scrim').hidden = true;
  modalOnConfirm = null;
}

// -------- Kick off --------

boot();
