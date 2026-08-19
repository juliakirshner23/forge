// =========================================================
// FORGE · Export / Backup
// =========================================================
// Dumps all IndexedDB data to a downloadable JSON file.
// This is the only way data leaves the device.
// =========================================================

import * as db from './db.js';

const APP_VERSION = '0.1.0';
const BACKUP_FORMAT_VERSION = 1;

export async function buildBackupJson() {
  const [exercises, routines, sessions, bodyMeasurements, dailyActivity, goals, settingsRows, metaRows] = await Promise.all([
    db.getAll('exercises'),
    db.getAll('routines'),
    db.getAll('sessions'),
    db.getAll('bodyMeasurements'),
    db.getAll('dailyActivity'),
    db.getAll('goals'),
    db.getAll('settings'),
    db.getAll('meta'),
  ]);

  // Flatten settings into an object for readability
  const settings = {};
  for (const row of settingsRows) settings[row.key] = row.value;

  const meta = {};
  for (const row of metaRows) meta[row.key] = row.value;

  return {
    export_metadata: {
      app: 'FORGE',
      appVersion: APP_VERSION,
      backupFormatVersion: BACKUP_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      counts: {
        exercises: exercises.length,
        routines: routines.length,
        sessions: sessions.length,
        bodyMeasurements: bodyMeasurements.length,
        dailyActivity: dailyActivity.length,
        goals: goals.length,
      },
    },
    exercises,
    routines,
    sessions,
    bodyMeasurements,
    dailyActivity,
    goals,
    settings,
    meta,
  };
}

export async function downloadBackup() {
  const json = await buildBackupJson();
  const text = JSON.stringify(json, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const stamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const filename = `forge-backup-${stamp}.json`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Free memory shortly after
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  return { filename, size: blob.size };
}

// -------- Restore from user-supplied FORGE backup file --------

export async function restoreFromBackupJson(json) {
  const summary = { exercises: 0, routines: 0, sessions: 0, bodyMeasurements: 0, dailyActivity: 0, goals: 0, settings: 0 };

  // Wipe everything first (restore is destructive by design)
  await db.clearAll();

  if (json.exercises) { await db.putMany('exercises', json.exercises); summary.exercises = json.exercises.length; }
  if (json.routines) { await db.putMany('routines', json.routines); summary.routines = json.routines.length; }
  if (json.sessions) { await db.putMany('sessions', json.sessions); summary.sessions = json.sessions.length; }
  if (json.bodyMeasurements) { await db.putMany('bodyMeasurements', json.bodyMeasurements); summary.bodyMeasurements = json.bodyMeasurements.length; }
  if (json.dailyActivity) { await db.putMany('dailyActivity', json.dailyActivity); summary.dailyActivity = json.dailyActivity.length; }
  if (json.goals) { await db.putMany('goals', json.goals); summary.goals = json.goals.length; }
  if (json.settings) {
    for (const [key, value] of Object.entries(json.settings)) {
      await db.setSetting(key, value);
    }
    summary.settings = Object.keys(json.settings).length;
  }

  await db.put('meta', {
    key: 'lastRestore',
    value: { restoredAt: new Date().toISOString(), source: json.export_metadata || null, summary },
  });

  return summary;
}
