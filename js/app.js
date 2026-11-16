// FORGE main entry: boot + hash router
import * as db from './db.js?v=31';
import { importBundledHevyBackup } from './import.js?v=31';
import { toast, startSentenceCase } from './ui.js?v=31';
import { renderHome, renderPlan, renderRoutine, renderLibrary, renderExercise, renderMe, renderTrail, renderBlock, renderProgress } from './screens.js?v=31';
import { migrateV100, migrateV101FreshStart, migrateV103Routines, migrateV105Alternatives } from './program.js?v=31';
import { renderSession } from './workout.js?v=31';
import { renderBody } from './body.js?v=31';
import { renderGoals } from './goals.js?v=31';
import { renderFood, renderFoodDay, renderFoodNew, renderFoodEdit } from './food.js?v=31';

const APP_VERSION = '1.0.6';

const ROUTES = {
  '/home':     renderHome,
  '/trail':    renderTrail,
  '/plan':     renderPlan,
  '/block':    renderBlock,
  '/routine':  renderRoutine,
  '/library':  renderLibrary,
  '/exercise': renderExercise,
  '/session':  renderSession,
  '/progress': renderProgress,
  '/log':      (c) => renderProgress(c, ['history']),
  '/history':  (c) => renderProgress(c, ['history']),
  '/stats':    (c) => renderProgress(c, ['charts']),
  '/body':     (c, p) => (p && p.length ? renderBody(c, p) : renderProgress(c, ['body'])),
  '/goals':    (c) => renderProgress(c, ['goals']),
  '/goal':     (c, p) => (p && p.length ? renderGoals(c, p) : renderProgress(c, ['goals'])),
  '/settings': renderMe,
  '/me':       renderMe,
  '/food':     renderFood,
  '/food-day': renderFoodDay,
  '/food-new': renderFoodNew,
  '/food-edit':renderFoodEdit,
};

let _routeToken = 0;

async function handleRoute() {
  const hash = window.location.hash.slice(1);
  const parts = hash.split('/').filter(Boolean);
  const routeKey = '/' + (parts[0] || 'home');
  const params = parts.slice(1);

  const handler = ROUTES[routeKey];
  const container = document.getElementById('app-content');
  const token = ++_routeToken;
  container.innerHTML = '';

  if (!handler) {
    container.innerHTML = `<section class="hero"><div class="eyebrow">404</div><h1>SCREEN NOT FOUND</h1><p class="hero-sub">No route for <code>${hash}</code>.</p></section>`;
    return;
  }
  // Render off-screen, then swap in only if no newer navigation happened.
  // Prevents doubled screens when two renders overlap.
  const stage = document.createElement('div');
  try {
    await handler(stage, params);
    if (token !== _routeToken) return;
    container.innerHTML = '';
    container.append(...stage.childNodes);
  }
  catch (err) {
    console.error('Screen error', err);
    container.innerHTML = `<section class="hero"><div class="eyebrow" style="color:#dc2626;">SCREEN ERROR</div><h1>SOMETHING BROKE</h1><p class="hero-sub">${err.message}</p></section>`;
  }
  updateActiveTab(routeKey);
  window.scrollTo(0, 0);
  updatePointsPill();
}

// v0.9.0 · Trail points in the header, on every screen.
async function updatePointsPill() {
  try {
    const { getStatus } = await import('./trail.js?v=31');
    const t = await getStatus();
    const pill = document.getElementById('topbar-points');
    if (pill) { pill.textContent = `${t.points} PTS`; pill.hidden = false; }
  } catch (err) { console.error('Points pill failed', err); }
}

function updateActiveTab(routeKey) {
  // Map sub-routes to their parent tab for highlighting
  const tabMap = {
    '/home': '/home', '/trail': '/home',
    '/plan': '/plan', '/block': '/plan', '/routine': '/plan', '/library': '/plan', '/exercise': '/plan',
    '/session': '/plan',
    '/food': '/food', '/food-day': '/food', '/food-new': '/food', '/food-edit': '/food',
    '/progress': '/progress', '/log': '/progress', '/history': '/progress', '/stats': '/progress',
    '/body': '/progress', '/goals': '/progress', '/goal': '/progress',
    '/me': null, '/settings': null,
  };
  const tabRoute = tabMap[routeKey] || routeKey;
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('tab-active', tab.dataset.route === tabRoute);
  });
}

export function refresh() { handleRoute(); }

async function boot() {
  try {
    console.log('FORGE boot · version', APP_VERSION);
    
    await db.openDb();
    startSentenceCase();
    await ensureSeedData();
    await migrateV050();
    await migrateV072();
    await migrateV074();
    await migrateV090();
    const mig = await migrateV100();
    const fresh = await migrateV101FreshStart();
    await migrateV103Routines();
    await migrateV105Alternatives();
    if (mig || fresh) toast('FORGE 1.0 · Fresh start · Trail begins Nov 16', 'ok', 4000);
    await applyTheme();
    await checkBackupReminder();
    if (!window.location.hash) window.location.hash = '#/home';
    window.addEventListener('hashchange', handleRoute);
    await handleRoute();
  } catch (err) {
    console.error('Boot failed:', err);
    document.getElementById('app-content').innerHTML =
      `<section class="hero"><div class="eyebrow" style="color:#dc2626;">BOOT FAILED</div><h1>ERROR</h1><p class="hero-sub">${err.message}</p></section>`;
  }
}

// v0.7.2 · Backfill `focus` on existing exercises using the same rules as import.
async function migrateV072() {
  const done = await db.get('meta', 'migrated_v072');
  if (done) return;
  const { inferFocus } = await import('./import.js?v=31');
  const exs = await db.getAll('exercises');
  for (const e of exs) {
    if (e.focus == null) {
      e.focus = inferFocus(e.name);
      e.updatedAt = new Date().toISOString();
      await db.put('exercises', e);
    }
  }
  await db.put('meta', { key: 'migrated_v072', value: { at: new Date().toISOString() } });
}

// v0.7.4 · Re-classify EVERY exercise (skips any with focusEditedByUser=true).
// Runs once because v0.7.2 froze bad classifications for many exercises.
async function migrateV074() {
  const done = await db.get('meta', 'migrated_v074');
  if (done) return;
  const { inferFocus } = await import('./import.js?v=31');
  const exs = await db.getAll('exercises');
  let changed = 0;
  for (const e of exs) {
    if (e.focusEditedByUser) continue;
    const fresh = inferFocus(e.name);
    if (fresh !== e.focus) {
      e.focus = fresh;
      e.updatedAt = new Date().toISOString();
      await db.put('exercises', e);
      changed++;
    }
  }
  await db.put('meta', { key: 'migrated_v074', value: { at: new Date().toISOString(), changed } });
  if (changed > 0) console.log(`v0.7.4 migration · reclassified ${changed} exercise(s)`);
}

// v0.9.0 · Light theme becomes the default (easier to read in the gym), and the
// trail habit layer starts today with Julia's heart rate calibration.
async function migrateV090() {
  const done = await db.get('meta', 'migrated_v090');
  if (done) return;
  const { localIso, DEFAULT_CALIBRATION, DEFAULT_STEP_BONUS } = await import('./trail.js?v=31');
  await db.setSetting('theme', 'light');
  if (!(await db.getSetting('trailStartDate'))) await db.setSetting('trailStartDate', localIso(new Date()));
  if (!(await db.getSetting('hrCalibration'))) await db.setSetting('hrCalibration', DEFAULT_CALIBRATION);
  if ((await db.getSetting('stepBonusPoints')) == null) await db.setSetting('stepBonusPoints', DEFAULT_STEP_BONUS);
  if (!(await db.getSetting('trailPauses'))) await db.setSetting('trailPauses', []);
  await db.put('meta', { key: 'migrated_v090', value: { at: new Date().toISOString() } });
}

async function applyTheme() {
  const t = await db.getSetting('theme', 'light');
  document.documentElement.setAttribute('data-theme', t);
}

async function checkBackupReminder() {
  try {
    const freq = await db.getSetting('backupReminder', 'monthly');
    if (freq === 'never') return;
    const meta = await db.get('meta', 'lastBackupPrompt');
    const lastMs = meta?.value?.at ? new Date(meta.value.at).getTime() : 0;
    const now = Date.now();
    const interval = freq === 'weekly' ? 7 * 86400000 : 30 * 86400000;
    if (now - lastMs < interval) return;
    // Show in-app toast reminder (works in every browser, no permission needed).
    setTimeout(() => {
      const { toast } = window.__forgeUi || {};
      // Fallback path — use direct DOM toast helper
      const t = document.getElementById('toast');
      if (t) {
        t.textContent = 'BACKUP REMINDER · GO TO ME → EXPORT BACKUP';
        t.className = 'toast show toast-ok';
        setTimeout(() => { t.className = 'toast toast-ok'; }, 6000);
      }
    }, 2500);
    // Optional: OS-level notification if user granted permission
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification('FORGE', { body: 'Time to back up your workout data.' }); } catch(e) {}
    }
    await db.put('meta', { key: 'lastBackupPrompt', value: { at: new Date().toISOString() } });
  } catch (err) { console.error('Backup reminder failed', err); }
}

async function ensureSeedData() {
  const meta = await db.get('meta', 'lastImport');
  if (meta) return;
  toast('IMPORTING YOUR HEVY DATA...', 'ok');
  const summary = await importBundledHevyBackup();
  toast(`IMPORTED · ${summary.exercises} EX · ${summary.routines} ROUTINES · ${summary.bodyMeasurements} MEASUREMENTS · ${summary.goals} GOALS`, 'ok', 3500);
}

// One-time backfill for users upgrading from < v0.5.0:
//   - Populate cardioMachine on existing cardio exercises
//   - Seed Stairmaster and Outdoor Run as custom exercises if not present
async function migrateV050() {
  const migrated = await db.get('meta', 'migrated_v050');
  if (migrated) return;
  const exs = await db.getAll('exercises');
  const nameToMachine = (n) => {
    const s = (n || '').toLowerCase();
    if (/stairmaster|stair climber|stairclimber/.test(s)) return 'stairmaster';
    if (/treadmill|incline walk/.test(s)) return 'treadmill';
    if (/elliptical/.test(s)) return 'elliptical';
    if (/outdoor run|road run|trail run/.test(s)) return 'outdoor_run';
    if (/cycling|air bike|recumbent|stationary bike/.test(s)) return 'bike';
    if (/rowing|rower|erg/.test(s)) return 'rower';
    return null;
  };
  for (const e of exs) {
    if (e.category === 'cardio' && e.cardioMachine == null) {
      e.cardioMachine = nameToMachine(e.name);
      e.updatedAt = new Date().toISOString();
      await db.put('exercises', e);
    }
  }
  const existingNames = new Set(exs.map((e) => (e.name || '').toLowerCase()));
  const nowIso = new Date().toISOString();
  const seeds = [
    { id: 'cu_seed_stairmaster', name: 'Stairmaster', machine: 'stairmaster', equipment: 'Stairmaster' },
    { id: 'cu_seed_outdoor_run', name: 'Outdoor Run',  machine: 'outdoor_run', equipment: 'None' },
  ];
  for (const s of seeds) {
    if (!existingNames.has(s.name.toLowerCase())) {
      await db.put('exercises', {
        id: s.id, name: s.name, category: 'cardio', cardioMachine: s.machine,
        primaryMuscles: [], secondaryMuscles: [], equipment: s.equipment,
        isCustom: true, notes: '', substituteIds: [], constraintFlags: [],
        hevyTemplateId: null, createdAt: nowIso, updatedAt: nowIso,
      });
    }
  }
  await db.put('meta', { key: 'migrated_v050', value: { migratedAt: nowIso } });
}

boot();
