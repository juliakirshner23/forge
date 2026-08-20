// =========================================================
// FORGE · Shared UI helpers
// =========================================================

import * as db from './db.js?v=8';

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

export function catBadge(category) {
  const map = { strength: 'S', cardio: 'C', core: 'K', mobility: 'M', rehab: 'R' };
  return el('span', { class: `cat cat-${category || 'strength'}`, text: map[category] || '?' });
}

export function focusTagEl(tag) {
  const tagClassMap = {
    push: 'tag-push', pull: 'tag-pull', legs: 'tag-legs', upper: 'tag-upper',
    core: 'tag-core', rehab: 'tag-rehab', cardio: 'tag-cardio', recovery: 'tag-recovery',
  };
  return el('span', { class: `tag ${tagClassMap[tag] || 'tag-neutral'}`, text: tag.toUpperCase() });
}

// -------- Time helpers --------

export const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const DAY_LABELS = { mon: 'MON', tue: 'TUE', wed: 'WED', thu: 'THU', fri: 'FRI', sat: 'SAT', sun: 'SUN' };
export const DAY_FULL   = { mon: 'MONDAY', tue: 'TUESDAY', wed: 'WEDNESDAY', thu: 'THURSDAY', fri: 'FRIDAY', sat: 'SATURDAY', sun: 'SUNDAY' };
export const CATEGORIES = ['strength', 'cardio', 'core', 'mobility', 'rehab'];

export function currentDayKey() {
  const d = new Date().getDay();
  return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d];
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
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
  const d = new Date(iso);
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

export function confirmModal(title, body, onConfirm) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').textContent = body;
  document.getElementById('modal-scrim').hidden = false;

  const btn = document.getElementById('modal-confirm');
  const fresh = btn.cloneNode(true);
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
