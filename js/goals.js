// FORGE goals CRUD
import * as db from './db.js?v=7';
import {
  el, section, notFound, formField, formSelect, formTextarea,
  progressBar, uid, toast, confirmModal, daysUntil, formatDate,
} from './ui.js?v=7';

const GOAL_TYPES = [
  { value: 'event', label: 'EVENT' },
  { value: 'weight', label: 'WEIGHT' },
  { value: 'pushup', label: 'PUSH-UP LADDER' },
  { value: 'clearance', label: 'CLEARANCE' },
  { value: 'custom', label: 'CUSTOM' },
];

export async function renderGoals(container, params) {
  const [action] = params;
  if (action === 'new') return renderGoalForm(container, null);
  if (action) {
    const g = await db.get('goals', action);
    if (!g) { container.appendChild(notFound('GOAL NOT FOUND', '#/goals', 'GOALS')); return; }
    return renderGoalForm(container, g);
  }
  return renderGoalsList(container);
}

async function renderGoalsList(container) {
  const [goals, measurements] = await Promise.all([db.getAll('goals'), db.getAll('bodyMeasurements')]);
  const latestWeight = measurements.length ? [...measurements].sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0] : null;

  container.appendChild(el('section', { class: 'hero' }, [
    el('div', { class: 'eyebrow' }, [
      el('a', { href: '#/me', class: 'crumb', text: '‹ ME' }),
      el('span', { text: `  ·  ${goals.length} GOALS` }),
    ]),
    el('h1', { text: 'GOALS' }),
  ]));

  container.appendChild(section('ADD', el('a', { class: 'btn btn-primary', href: '#/goal/new' }, [
    el('span', { class: 'btn-title', text: '+ NEW GOAL' }),
    el('span', { class: 'btn-sub', text: 'TRACK ANOTHER TARGET' }),
  ])));

  if (goals.length === 0) {
    container.appendChild(section('YOUR GOALS', el('div', { class: 'empty-note', text: 'NO GOALS YET' })));
    return;
  }

  const list = el('div', { class: 'action-stack' });
  for (const g of goals.sort((a, b) => (a.targetDate || '').localeCompare(b.targetDate || ''))) {
    list.appendChild(goalCard(g, latestWeight));
  }
  container.appendChild(section(`YOUR GOALS  ·  ${goals.length}`, list));
}

function goalCard(g, latestWeight) {
  const days = g.targetDate ? daysUntil(g.targetDate) : null;
  let progressPct = null;
  let subText = '';

  if (g.type === 'weight') {
    const start = g.startValue ?? 0;
    const target = g.targetValue ?? 0;
    const current = latestWeight?.weight ?? start;
    const total = start - target;
    const done = start - current;
    if (total > 0) progressPct = Math.max(0, Math.min(100, (done / total) * 100));
    subText = `${current} LB → ${target} LB`;
  } else if (g.type === 'pushup') {
    const phases = g.metadata?.phases || [];
    const idx = g.metadata?.currentPhaseIndex ?? 0;
    if (phases.length > 0) progressPct = ((idx + 1) / phases.length) * 100;
    subText = `PHASE ${idx + 1} OF ${phases.length}: ${(phases[idx] || '').toUpperCase()}`;
  } else if (g.targetDate) {
    subText = formatDate(g.targetDate);
  }

  const card = el('a', { class: 'mission-card', href: `#/goal/${g.id}`, style: 'display: block; text-decoration: none; color: inherit;' }, [
    el('div', { class: 'mission-header' }, [
      el('span', { class: 'mission-title', text: '◆ ' + g.title.toUpperCase() }),
      days != null ? el('span', { class: 'mission-days', text: `${days}D` }) : null,
    ]),
    subText ? el('div', { class: 'mission-metrics' }, [ el('span', { class: 'mission-current', text: subText }) ]) : null,
    progressPct != null ? progressBar(progressPct, { label: g.type.toUpperCase(), value: `${Math.round(progressPct)}%` }) : null,
    el('div', { class: 'mission-sub', text: 'TAP TO EDIT →' }),
  ]);
  return card;
}

async function renderGoalForm(container, existing) {
  const isEdit = !!existing;
  const model = isEdit ? { ...existing, metadata: { ...(existing.metadata || {}) } } : {
    id: uid('gl'), type: 'custom', title: '',
    targetValue: null, targetDate: null, currentValue: null, startValue: null,
    metadata: {}, createdAt: new Date().toISOString(),
  };

  container.appendChild(el('section', { class: 'hero' }, [
    el('div', { class: 'eyebrow' }, [
      el('a', { href: '#/goals', class: 'crumb', text: '‹ GOALS' }),
      el('span', { text: '  ·  ' + (isEdit ? 'EDITING' : 'NEW GOAL') }),
    ]),
    el('h1', { text: isEdit ? 'EDIT GOAL' : 'NEW GOAL' }),
  ]));

  const form = el('div', { class: 'form-stack' });
  form.appendChild(formField('TITLE', 'text', 'title', model.title, 'e.g. Run a 5K'));
  form.appendChild(formSelect('TYPE', 'type', model.type, GOAL_TYPES));
  form.appendChild(formField('TARGET DATE', 'date', 'targetDate', model.targetDate || '', ''));
  form.appendChild(formField('TARGET VALUE (OPTIONAL)', 'number', 'targetValue', model.targetValue ?? '', 'e.g. 170', { step: '0.1' }));
  form.appendChild(formField('START VALUE (OPTIONAL)', 'number', 'startValue', model.startValue ?? '', 'e.g. 266', { step: '0.1' }));

  // Push-up specific: current phase index
  if (model.type === 'pushup' || (model.metadata && model.metadata.phases)) {
    const phases = model.metadata?.phases || ['wall', 'high incline', 'mid incline', 'low incline', 'full'];
    const idx = model.metadata?.currentPhaseIndex ?? 0;
    form.appendChild(formSelect('CURRENT PHASE', 'currentPhaseIndex', String(idx),
      phases.map((p, i) => ({ value: String(i), label: `${i + 1}. ${p.toUpperCase()}` }))));
  }

  container.appendChild(section('DETAILS', form));

  const saveBtn = el('button', { class: 'btn btn-primary' }, [
    el('span', { class: 'btn-title', text: isEdit ? 'SAVE CHANGES' : 'CREATE GOAL' }),
    el('span', { class: 'btn-sub', text: isEdit ? 'UPDATE' : 'ADDS TO YOUR GOALS' }),
  ]);
  saveBtn.addEventListener('click', async () => {
    const updated = {
      ...model,
      title: form.querySelector('[name="title"]').value.trim(),
      type: form.querySelector('[name="type"]').value,
      targetDate: form.querySelector('[name="targetDate"]').value || null,
      targetValue: form.querySelector('[name="targetValue"]').value ? Number(form.querySelector('[name="targetValue"]').value) : null,
      startValue: form.querySelector('[name="startValue"]').value ? Number(form.querySelector('[name="startValue"]').value) : null,
      updatedAt: new Date().toISOString(),
    };
    const phaseInput = form.querySelector('[name="currentPhaseIndex"]');
    if (phaseInput) {
      updated.metadata = { ...(updated.metadata || {}), currentPhaseIndex: Number(phaseInput.value) };
      if (!updated.metadata.phases) updated.metadata.phases = ['wall', 'high incline', 'mid incline', 'low incline', 'full'];
    }
    if (!updated.title) { toast('TITLE REQUIRED', 'error'); return; }
    try { await db.put('goals', updated); toast(isEdit ? 'SAVED' : 'GOAL CREATED', 'ok'); window.location.hash = '#/goals'; }
    catch (err) { console.error(err); toast('SAVE FAILED · ' + err.message, 'error'); }
  });

  const actions = [saveBtn, el('a', { class: 'btn btn-outline', href: '#/goals' }, [
    el('span', { class: 'btn-title', text: 'CANCEL' }),
    el('span', { class: 'btn-sub', text: 'DISCARD' }),
  ])];
  if (isEdit) {
    actions.push(el('button', { class: 'btn btn-danger', onclick: () => {
      confirmModal('DELETE GOAL?', 'Permanently delete this goal.', async () => {
        await db.remove('goals', model.id); toast('DELETED', 'ok'); window.location.hash = '#/goals';
      });
    } }, [
      el('span', { class: 'btn-title', text: 'DELETE GOAL' }),
      el('span', { class: 'btn-sub', text: 'IRREVERSIBLE' }),
    ]));
  }
  container.appendChild(section('SAVE', el('div', { class: 'action-stack' }, actions)));
}
