// =========================================================
// FORGE · Main app entry
// =========================================================

import * as db from './db.js';
import { importBundledHevyBackup } from './import.js';
import { downloadBackup, restoreFromBackupJson } from './export.js';

// -------- Service worker registration (best-effort) --------

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      // Not fatal — app works fine online
    });
  });
}

// -------- App boot --------

async function boot() {
  try {
    await db.openDb();
    await ensureSeedData();
    await renderStatus();
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
    { label: 'EXERCISES',    value: exCount,    sub: 'IN LIBRARY',    highlight: true },
    { label: 'ROUTINES',     value: rtCount,    sub: 'ALL PROGRAMS' },
    { label: 'MEASUREMENTS', value: bmCount,    sub: 'BODY LOG' },
    { label: 'SESSIONS',     value: sessCount,  sub: 'WORKOUTS LOGGED' },
    { label: 'GOALS',        value: goalCount,  sub: 'TRACKED' },
    { label: 'DAILY ACTIVITY', value: daCount,  sub: 'DAYS LOGGED' },
  ];

  for (const c of cards) {
    const el = document.createElement('div');
    el.className = 'stat-card';
    if (c.highlight) el.setAttribute('data-highlight', '');
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

// -------- Event wiring --------

function wireEvents() {
  document.getElementById('btn-export').addEventListener('click', onExport);
  document.getElementById('btn-import').addEventListener('click', onImportClick);
  document.getElementById('file-input').addEventListener('change', onFileChosen);
  document.getElementById('btn-clear').addEventListener('click', onClearClick);
  document.getElementById('btn-reimport').addEventListener('click', onReimportClick);
  document.getElementById('modal-cancel').addEventListener('click', hideModal);
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
