// FORGE main entry: boot + hash router
import * as db from './db.js?v=9';
import { importBundledHevyBackup } from './import.js?v=9';
import { toast } from './ui.js?v=9';
import { renderHome, renderPlan, renderRoutine, renderLibrary, renderExercise, renderStats, renderMe } from './screens.js?v=9';
import { renderLog, renderSession } from './workout.js?v=9';
import { renderHistory } from './history.js?v=9';
import { renderBody } from './body.js?v=9';
import { renderGoals } from './goals.js?v=9';
import { renderSettings } from './settings.js?v=9';
import { renderFood, renderFoodDay, renderFoodNew, renderFoodEdit } from './food.js?v=9';

const APP_VERSION = '0.4.1';

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
    if (!window.location.hash) window.location.hash = '#/home';
    window.addEventListener('hashchange', handleRoute);
    await handleRoute();
  } catch (err) {
    console.error('Boot failed:', err);
    document.getElementById('app-content').innerHTML =
      `<section class="hero"><div class="eyebrow" style="color:#dc2626;">BOOT FAILED</div><h1>ERROR</h1><p class="hero-sub">${err.message}</p></section>`;
  }
}

async function ensureSeedData() {
  const meta = await db.get('meta', 'lastImport');
  if (meta) return;
  toast('IMPORTING YOUR HEVY DATA...', 'ok');
  const summary = await importBundledHevyBackup();
  toast(`IMPORTED · ${summary.exercises} EX · ${summary.routines} ROUTINES · ${summary.bodyMeasurements} MEASUREMENTS · ${summary.goals} GOALS`, 'ok', 3500);
}

boot();
