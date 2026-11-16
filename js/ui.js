// =========================================================
// FORGE · Shared UI helpers
// =========================================================

import * as db from './db.js?v=28';

// -------- DOM builder --------

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'onclick') node.addEventListener('click', v);
    else if (k === 'oninput') node.addEventListener('input', v);
    else if (k === 'onchange') node.addEventListener('change', v);
    else if (k === 'style') node.setAttribute('style', v);
    else if (k.startsWith('data-') || k.startsWith('aria-')) node.setAttribute(k, v);
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    if (typeof child === 'string' || typeof child === 'number') node.appendChild(document.createTextNode(String(child)));
    else node.appendChild(child);
  }
  return node;
}

export function section(labelText, content) {
  const children = [];
  if (labelText) children.push(el('div', { class: 'section-label', text: labelText }));
  children.push(content);
  return el('section', { class: 'section' }, children);
}

export function notFound(title, backHref, backLabel) {
  return el('section', { class: 'hero' }, [
    el('div', { class: 'eyebrow', text: 'NOT FOUND' }),
    el('h1', { text: title }),
    el('a', { class: 'nav-row', href: backHref, style: 'margin-top: 20px;' }, [
      el('div', { class: 'nav-row-main' }, [ el('div', { class: 'nav-row-title', text: `← BACK TO ${backLabel}` }) ]),
    ]),
  ]);
}

// -------- Form fields --------

export function formField(label, type, name, value, placeholder = '', extra = {}) {
  const inputAttrs = { class: 'form-input', type, name, value: value == null ? '' : value, placeholder, ...extra };
  return el('label', { class: 'form-field' }, [
    el('span', { class: 'form-label', text: label }),
    el('input', inputAttrs),
  ]);
}

export function formSelect(label, name, value, options) {
  const wrap = el('label', { class: 'form-field' }, [ el('span', { class: 'form-label', text: label }) ]);
  const select = el('select', { class: 'form-input form-select', name });
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    if (opt.value === value) o.selected = true;
    select.appendChild(o);
  }
  wrap.appendChild(select);
  return wrap;
}

export function formTextarea(label, name, value, placeholder = '', rows = 4) {
  return el('label', { class: 'form-field' }, [
    el('span', { class: 'form-label', text: label }),
    el('textarea', { class: 'form-input form-textarea', name, rows: String(rows), placeholder, text: value || '' }),
  ]);
}

// -------- Badges + tags --------

// Category badge (v1.0.0: one category field: push/pull/legs/core/cardio/rehab).
const CAT_SHORT = { push: 'PUSH', pull: 'PULL', legs: 'LEGS', core: 'CORE', cardio: 'CARDIO', rehab: 'REHAB' };
export function catOf(exOrCategory) {
  if (typeof exOrCategory === 'string') return CAT_SHORT[exOrCategory] ? exOrCategory : 'other';
  const c = exOrCategory?.category;
  if (CAT_SHORT[c]) return c;
  if (CAT_SHORT[exOrCategory?.focus]) return exOrCategory.focus;
  return 'other';
}
export function catBadge(exOrCategory) {
  const c = catOf(exOrCategory);
  return el('span', { class: `cat cat-${c}`, text: CAT_SHORT[c] || 'OTHER' });
}

export function focusTagEl(tag) {
  return el('span', { class: `tag tag-${CAT_SHORT[tag] ? tag : 'neutral'}`, text: tag.toUpperCase() });
}

// Category tags for a routine, derived from its exercises (in a fixed order).
export function routineTags(routine, exById) {
  const order = ['push', 'pull', 'legs', 'core', 'cardio', 'rehab'];
  const set = new Set((routine.exercises || []).map((e) => catOf(exById.get(e.exerciseId) || {})));
  return order.filter((c) => set.has(c));
}

// -------- Time helpers --------

export const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const DAY_LABELS = { mon: 'MON', tue: 'TUE', wed: 'WED', thu: 'THU', fri: 'FRI', sat: 'SAT', sun: 'SUN' };
export const DAY_FULL   = { mon: 'MONDAY', tue: 'TUESDAY', wed: 'WEDNESDAY', thu: 'THURSDAY', fri: 'FRIDAY', sat: 'SATURDAY', sun: 'SUNDAY' };
export const CATEGORIES = ['push', 'pull', 'legs', 'core', 'cardio', 'rehab'];

export function currentDayKey() {
  const d = new Date().getDay();
  return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d];
}

export function todayIso() {
  // Local date, not UTC — otherwise late-evening users west of UTC get tomorrow's date.
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Local calendar day (phone time zone) for a timestamp or Date.
export function localDay(ts) {
  const d = ts instanceof Date ? ts : new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function daysUntil(iso) {
  const target = new Date(iso).getTime();
  return Math.max(0, Math.ceil((target - Date.now()) / 86400000));
}

export function daysBetween(iso1, iso2) {
  return Math.round((new Date(iso2).getTime() - new Date(iso1).getTime()) / 86400000);
}

export function formatDuration(seconds) {
  if (seconds == null) return '';
  if (seconds < 60) return `${seconds}S`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}M` : `${m}M ${s}S`;
}

export function formatMinSec(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatDate(iso) {
  if (!iso) return '';
  // Date-only strings (YYYY-MM-DD) must be parsed as LOCAL midnight, not UTC,
  // or west-of-UTC users see the previous day.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso + 'T00:00:00') : new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function uid(prefix = 'x') {
  return prefix + '_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// -------- Tri-color goal rule --------

export function progressColor(pct) {
  if (pct >= 100) return 'var(--green)';
  if (pct >= 33) return 'var(--amber)';
  return 'var(--red)';
}

// -------- Toast --------

let toastTimer = null;
export function toast(msg, kind = '', duration = 2500) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast show ' + (kind === 'ok' ? 'toast-ok' : kind === 'error' ? 'toast-error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = 'toast ' + (kind === 'ok' ? 'toast-ok' : kind === 'error' ? 'toast-error' : '');
  }, duration);
}

// -------- Confirmation modal --------

// Two-choice question. Resolves true (yes) or false (no).
export function askModal(title, body, yesLabel = 'YES', noLabel = 'NO') {
  return new Promise((resolve) => {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').textContent = body;
    const btn = document.getElementById('modal-confirm');
    const fresh = btn.cloneNode(true);
    btn.parentNode.replaceChild(fresh, btn);
    fresh.textContent = yesLabel;
    fresh.className = 'btn btn-primary';
    const cancel = document.getElementById('modal-cancel');
    cancel.textContent = noLabel;
    document.getElementById('modal-scrim').hidden = false;
    fresh.addEventListener('click', () => { document.getElementById('modal-scrim').hidden = true; resolve(true); });
    cancel.onclick = () => { document.getElementById('modal-scrim').hidden = true; resolve(false); };
  });
}

export function confirmModal(title, body, onConfirm) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').textContent = body;
  document.getElementById('modal-scrim').hidden = false;

  const btn = document.getElementById('modal-confirm');
  const fresh = btn.cloneNode(true);
  fresh.textContent = 'CONFIRM';
  fresh.className = 'btn btn-danger';
  document.getElementById('modal-cancel').textContent = 'CANCEL';
  btn.parentNode.replaceChild(fresh, btn);
  fresh.addEventListener('click', async () => {
    document.getElementById('modal-scrim').hidden = true;
    if (onConfirm) await onConfirm();
  });
  document.getElementById('modal-cancel').onclick = () => {
    document.getElementById('modal-scrim').hidden = true;
  };
}

// -------- Inspector modal (used for pickers + data inspection) --------

export function openPicker(title, items, onPick) {
  document.getElementById('inspector-title').textContent = title;
  const body = document.getElementById('inspector-body');
  body.innerHTML = '';
  if (items.length === 0) {
    body.innerHTML = `<div class="inspector-empty">NO OPTIONS</div>`;
  } else {
    for (const item of items) {
      const btn = document.createElement('button');
      btn.className = 'flag-picker-row';
      btn.textContent = item.label;
      btn.addEventListener('click', () => {
        document.getElementById('inspector-scrim').hidden = true;
        onPick(item);
      });
      body.appendChild(btn);
    }
  }
  document.getElementById('inspector-scrim').hidden = false;
}

// -------- Wire close buttons once --------

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('inspector-close')?.addEventListener('click', () => {
    document.getElementById('inspector-scrim').hidden = true;
  });
  document.getElementById('inspector-scrim')?.addEventListener('click', (e) => {
    if (e.target.id === 'inspector-scrim') document.getElementById('inspector-scrim').hidden = true;
  });
});

// -------- Progress bar --------

export function progressBar(pct, opts = {}) {
  const clamped = Math.max(0, Math.min(pct, 100));
  const wrap = el('div', { class: 'pbar' }, [
    el('div', { class: 'pbar-fill', style: `width: ${clamped}%; background: ${progressColor(pct)};` }),
  ]);
  if (opts.label) {
    return el('div', { class: 'pbar-wrap' }, [
      el('div', { class: 'pbar-label' }, [
        el('span', { text: opts.label }),
        el('span', { class: 'pbar-value', text: opts.value || `${Math.round(pct)}%` }),
      ]),
      wrap,
    ]);
  }
  return wrap;
}

// -------- Small helpers --------

export async function getActiveSession() {
  const sessions = await db.getAll('sessions');
  return sessions.find((s) => s.isActive === true) || null;
}

// ---------- v1.0.1 · Sentence case display ----------
// Screens are written in ALL CAPS; this shows them in sentence case.
// Only text that is entirely uppercase is changed, so exercise names,
// food names, and anything you type in mixed case are left alone.
const KEEP_UPPER = new Set(['pt', 'pr', 'vr', 'iyt', 'hr', 'rpe', 'json', 'met', 'ok', 'id', 'diy', 'usa', 'ii', 'iii', 'iv', 'kg', 'cm']);
const LOWER_UNITS = new Set(['lb', 'lbs', 'mi', 'km', 'in', 'ft', 'm', 'kcal', 'min', 'sec', 'bpm', 'mph', 'kg', 'cm']);
const CAP_WORDS = new Set(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'hevy', 'icloud', 'drive', 'stairmaster', 'llactapata', 'sayacmarca', 'phuyupatamarca', 'kilimanjaro', 'forge']);
const PHRASES = [
  [/\binca trail\b/gi, 'Inca Trail'], [/\bmachu picchu\b/gi, 'Machu Picchu'], [/\bdead woman's pass\b/gi, "Dead Woman's Pass"],
  [/\brunkurakay pass\b/gi, 'Runkurakay Pass'], [/\bwiñay wayna\b/gi, 'Wiñay Wayna'], [/\bayapata camp\b/gi, 'Ayapata Camp'],
  [/\bphase (i{1,3}|iv)\b/gi, (m, n) => 'phase ' + n.toUpperCase()], [/\b1rm\b/gi, '1RM'], [/\bprs\b/gi, 'PRs'],
  [/\bicloud\b/gi, 'iCloud'],
];
function fixWord(w) {
  const lw = w.toLowerCase();
  if (KEEP_UPPER.has(lw) && lw !== 'kg' && lw !== 'cm') return w.toUpperCase();
  if (LOWER_UNITS.has(lw)) return lw;
  if (CAP_WORDS.has(lw)) return lw === 'icloud' ? 'iCloud' : lw.charAt(0).toUpperCase() + lw.slice(1);
  if (w.length === 1 && lw !== 'a') return w.toUpperCase();
  return lw;
}
export function toSentenceCase(str) {
  if (!str || !/[A-Z]{2}/.test(str) || /[a-z]/.test(str)) return str;
  let out = str.replace(/[A-Za-zÀ-ÿñÑ0-9']+/g, (w) => (/^\d/.test(w) ? w.toLowerCase().replace(/rm$/, 'RM') : fixWord(w)));
  for (const [re, rep] of PHRASES) out = out.replace(re, rep);
  // Capitalize the start and the first letter after a separator.
  out = out.replace(/(^|[·:—–\-•|?!.]\s+|^\s*[^A-Za-z0-9]*\s*)([a-zà-ÿñ][a-zà-ÿñ']*)/g, (m, p, w) => (LOWER_UNITS.has(w) ? m : p + w.charAt(0).toUpperCase() + w.slice(1)));
  return out;
}
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT']);
export function sentenceCaseTree(root) {
  if (!root) return;
  if (root.nodeType === 3) { // text node
    const p = root.parentNode;
    if (!p || SKIP_TAGS.has(p.nodeName) || p.closest?.('.brand, [data-keep-case]')) return;
    const v = root.nodeValue; const nv = toSentenceCase(v);
    if (nv !== v) root.nodeValue = nv;
    return;
  }
  if (root.nodeType !== 1 || SKIP_TAGS.has(root.nodeName) || root.closest?.('.brand, [data-keep-case]')) return;
  for (const attr of ['placeholder', 'aria-label', 'title']) {
    const a = root.getAttribute?.(attr);
    if (a) { const na = toSentenceCase(a); if (na !== a) root.setAttribute(attr, na); }
  }
  if (root.tagName === 'OPTION') { const t = root.textContent; const nt = toSentenceCase(t); if (nt !== t) root.textContent = nt; return; }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n = walker.nextNode();
  while (n) {
    if (n.nodeType === 3) sentenceCaseTree(n);
    else if (n.getAttribute) {
      for (const attr of ['placeholder', 'aria-label', 'title']) {
        const a = n.getAttribute(attr);
        if (a) { const na = toSentenceCase(a); if (na !== a) n.setAttribute(attr, na); }
      }
    }
    n = walker.nextNode();
  }
}
export function startSentenceCase() {
  sentenceCaseTree(document.body);
  const obs = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'characterData') sentenceCaseTree(m.target);
      else m.addedNodes.forEach((n) => sentenceCaseTree(n));
    }
  });
  obs.observe(document.body, { childList: true, subtree: true, characterData: true });
}
