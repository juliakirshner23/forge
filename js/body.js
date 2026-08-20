// FORGE body metrics: list, add, edit measurements
import * as db from './db.js?v=8';
import {
  el, section, notFound, formField, formTextarea, uid, toast, confirmModal, todayIso, formatDate,
} from './ui.js?v=8';

const FIELDS = [
  { key: 'weight', label: 'WEIGHT (LB)', unit: 'LB' },
  { key: 'waist', label: 'WAIST (IN)', unit: 'IN' },
  { key: 'hips', label: 'HIPS (IN)', unit: 'IN' },
  { key: 'chest', label: 'CHEST (IN)', unit: 'IN' },
  { key: 'neck', label: 'NECK (IN)', unit: 'IN' },
  { key: 'leftBicep', label: 'LEFT BICEP (IN)', unit: 'IN' },
  { key: 'rightBicep', label: 'RIGHT BICEP (IN)', unit: 'IN' },
  { key: 'leftThigh', label: 'LEFT THIGH (IN)', unit: 'IN' },
  { key: 'rightThigh', label: 'RIGHT THIGH (IN)', unit: 'IN' },
  { key: 'leftCalf', label: 'LEFT CALF (IN)', unit: 'IN' },
  { key: 'rightCalf', label: 'RIGHT CALF (IN)', unit: 'IN' },
  { key: 'wrist', label: 'WRIST (IN)', unit: 'IN' },
];

export async function renderBody(container, params) {
  const [action] = params;
  if (action === 'new') return renderBodyForm(container, null);
  if (action) {
    const bm = await db.get('bodyMeasurements', action);
    if (!bm) { container.appendChild(notFound('MEASUREMENT NOT FOUND', '#/body', 'BODY METRICS')); return; }
    return renderBodyForm(container, bm);
  }
  return renderBodyList(container);
}

async function renderBodyList(container) {
  const measurements = (await db.getAll('bodyMeasurements'))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const latest = measurements[0];

  container.appendChild(el('section', { class: 'hero' }, [
    el('div', { class: 'eyebrow' }, [
      el('a', { href: '#/me', class: 'crumb', text: '‹ ME' }),
      el('span', { text: `  ·  ${measurements.length} ENTRIES` }),
    ]),
    el('h1', { text: 'BODY METRICS' }),
    latest ? el('p', { class: 'hero-meta', text: `LATEST · ${formatDate(latest.date)}  ·  ${latest.weight != null ? latest.weight + ' LB' : 'NO WEIGHT'}` }) : null,
  ]));

  container.appendChild(section('ADD', el('a', { class: 'btn btn-primary', href: '#/body/new' }, [
    el('span', { class: 'btn-title', text: '+ NEW ENTRY' }),
    el('span', { class: 'btn-sub', text: 'LOG WEIGHT + MEASUREMENTS' }),
  ])));

  if (measurements.length === 0) {
    container.appendChild(section('ENTRIES', el('div', { class: 'empty-note', text: 'NO MEASUREMENTS LOGGED YET' })));
    return;
  }

  const list = el('div', {});
  for (const bm of measurements) {
    const bits = [];
    if (bm.weight != null) bits.push(`${bm.weight}LB`);
    if (bm.waist != null) bits.push(`W${bm.waist}`);
    if (bm.hips != null) bits.push(`H${bm.hips}`);
    list.appendChild(el('a', { class: 'nav-row', href: `#/body/${bm.id}` }, [
      el('div', { class: 'nav-row-main' }, [
        el('div', { class: 'nav-row-title', text: formatDate(bm.date) }),
        el('div', { class: 'nav-row-sub', text: bits.join('  ·  ') || 'NO DATA' }),
      ]),
      el('div', { class: 'nav-row-arrow', text: '›' }),
    ]));
  }
  container.appendChild(section(`ALL ENTRIES  ·  ${measurements.length}`, list));
}

async function renderBodyForm(container, existing) {
  const isEdit = !!existing;
  const model = isEdit ? { ...existing } : {
    id: uid('bm'),
    date: todayIso(),
    units: 'imperial',
    notes: '',
    createdAt: new Date().toISOString(),
  };

  container.appendChild(el('section', { class: 'hero' }, [
    el('div', { class: 'eyebrow' }, [
      el('a', { href: '#/body', class: 'crumb', text: '‹ BODY METRICS' }),
      el('span', { text: '  ·  ' + (isEdit ? 'EDITING' : 'NEW ENTRY') }),
    ]),
    el('h1', { text: isEdit ? 'EDIT ENTRY' : 'NEW ENTRY' }),
  ]));

  const form = el('div', { class: 'form-stack' });
  form.appendChild(formField('DATE', 'date', 'date', model.date, ''));
  for (const f of FIELDS) {
    form.appendChild(formField(f.label, 'number', f.key, model[f.key] ?? '', '', { step: '0.1' }));
  }
  form.appendChild(formTextarea('NOTES', 'notes', model.notes, 'How you\'re feeling, changes, etc.'));
  container.appendChild(section('MEASUREMENTS', form));

  const saveBtn = el('button', { class: 'btn btn-primary' }, [
    el('span', { class: 'btn-title', text: isEdit ? 'SAVE CHANGES' : 'SAVE ENTRY' }),
    el('span', { class: 'btn-sub', text: 'STORE ON DEVICE' }),
  ]);
  saveBtn.addEventListener('click', async () => {
    const updated = { ...model, date: form.querySelector('[name="date"]').value, notes: form.querySelector('[name="notes"]').value.trim(), updatedAt: new Date().toISOString() };
    for (const f of FIELDS) {
      const v = form.querySelector(`[name="${f.key}"]`).value;
      updated[f.key] = v ? Number(v) : null;
    }
    if (!updated.date) { toast('DATE REQUIRED', 'error'); return; }
    try { await db.put('bodyMeasurements', updated); toast(isEdit ? 'SAVED' : 'ENTRY LOGGED', 'ok'); window.location.hash = '#/body'; }
    catch (err) { console.error(err); toast('SAVE FAILED · ' + err.message, 'error'); }
  });

  const actions = [saveBtn, el('a', { class: 'btn btn-outline', href: '#/body' }, [
    el('span', { class: 'btn-title', text: 'CANCEL' }),
    el('span', { class: 'btn-sub', text: 'DISCARD' }),
  ])];
  if (isEdit) {
    actions.push(el('button', { class: 'btn btn-danger', onclick: () => {
      confirmModal('DELETE ENTRY?', 'Permanently delete this measurement.', async () => {
        await db.remove('bodyMeasurements', model.id); toast('DELETED', 'ok'); window.location.hash = '#/body';
      });
    } }, [
      el('span', { class: 'btn-title', text: 'DELETE ENTRY' }),
      el('span', { class: 'btn-sub', text: 'IRREVERSIBLE' }),
    ]));
  }
  container.appendChild(section('SAVE', el('div', { class: 'action-stack' }, actions)));
}
