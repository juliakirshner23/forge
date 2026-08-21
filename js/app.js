// FORGE main entry: boot + hash router
import * as db from './db.js?v=13';
import { importBundledHevyBackup } from './import.js?v=13';
import { toast } from './ui.js?v=13';
import { renderHome, renderPlan, renderRoutine, renderLibrary, renderExercise, renderStats, renderMe } from './screens.js?v=13';
import { renderLog, renderSession } from './workout.js?v=13';
import { renderHistory } from './history.js?v=13';
import { renderBody } from './body.js?v=13';
import { renderGoals } from './goals.js?v=13';
import { renderSettings } from './settings.js?v=13';
import { renderFood, renderFoodDay, renderFoodNew, renderFoodEdit } from './food.js?v=13';

const APP_VERSION = '0.7.0';

const ROUTES = {
  '/home':     renderHome,
  '/plan':     renderPlan,
  '/routine':  renderRoutine,
  '/library':  renderLibrary,
  '/exercise': renderExercise,
  '/log':      renderLog,
  '/session':  renderSession,
  '/history':  renderHistory,
  '/body':     renderBody,
  '/goals':    renderGoals,
  '/goal':     renderGoals,
  '/stats':    renderStats,
  '/settings': renderSettings,
  '/me':       renderMe,
  '/food':     renderFood,
  '/food-day': renderFoodDay,
  '/food-new': renderFoodNew,
  '/food-edit':renderFoodEdit,
};

async function handleRoute() {
  const hash = window.location.hash.slice(1);
  const parts = hash.split('/').filter(Boolean);
  const routeKey = '/' + (parts[0] || 'home');
  const params = parts.slice(1);

  const handler = ROUTES[routeKey];
  const container = document.getElementById('app-content');
  container.innerHTML = '';

  if (!handler) {
    container.innerHTML = `<section class="hero"><div class="eyebrow">404</div><h1>SCREEN NOT FOUND</h1><p class="hero-sub">No route for <code>${hash}</code>.</p></section>`;
    return;
  }
  try { await handler(container, params); }
  catch (err) {
    console.error('Screen error', err);
    container.innerHTML = `<section class="hero"><div class="eyebrow" style="color:#dc2626;">SCREEN ERROR</div><h1>SOMETHING BROKE</h1><p class="hero-sub">${err.message}</p></section>`;
  }
  updateActiveTab(routeKey);
  window.scrollTo(0, 0);
}

function updateActiveTab(routeKey) {
  // Map sub-routes to their parent tab for highlighting
  const tabMap = {
    '/home': '/home',
    '/plan': '/plan', '/routine': '/plan', '/library': '/plan', '/exercise': '/plan',
    '/log': '/log', '/session': '/log', '/history': '/log',
    '/food': '/food', '/food-day': '/food', '/food-new': '/food', '/food-edit': '/food',
    '/stats': '/stats', '/body': '/stats',
    // /me and its sub-routes have no bottom tab; ME lives in top-right of header.
    '/me': null, '/goals': null, '/goal': null, '/settings': null,
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
    document.getElementById('topbar-meta').textContent = 'v' + APP_VERSION;
    await db.openDb();
    await ensureSeedData();
    await migrateV050();
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

async function applyTheme() {
  const t = await db.getSetting('theme', 'dark');
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
