// =========================================================
// FORGE · App entry
// =========================================================
// Boot + hash router. All screen rendering is in screens.js.
// =========================================================

import * as db from './db.js?v=5';
import { importBundledHevyBackup } from './import.js?v=5';
import {
  renderHome, renderPlan, renderRoutine, renderLibrary,
  renderLog, renderStats, renderMe,
  toast,
} from './screens.js?v=5';

const APP_VERSION = '0.2.0';

// -------- Router --------

const ROUTES = {
  '/home':    renderHome,
  '/plan':    renderPlan,
  '/routine': renderRoutine,
  '/library': renderLibrary,
  '/log':     renderLog,
  '/stats':   renderStats,
  '/me':      renderMe,
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

  try {
    await handler(container, params);
  } catch (err) {
    console.error('Screen error', err);
    container.innerHTML = `<section class="hero"><div class="eyebrow" style="color:#dc2626;">SCREEN ERROR</div><h1>SOMETHING BROKE</h1><p class="hero-sub">${err.message}</p></section>`;
  }

  updateActiveTab(routeKey);
  window.scrollTo(0, 0);
}

function updateActiveTab(routeKey) {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('tab-active', tab.dataset.route === routeKey);
  });
}

// -------- Public: refresh current route (called from screens.js after data changes) --------

export function refresh() {
  handleRoute();
}

// -------- Boot --------

async function boot() {
  try {
    console.log('FORGE boot · version', APP_VERSION);
    document.getElementById('topbar-meta').textContent = 'v' + APP_VERSION;

    await db.openDb();
    await ensureSeedData();

    // Default route
    if (!window.location.hash) {
      window.location.hash = '#/home';
    }
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
