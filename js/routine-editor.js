// FORGE routine editor
import * as db from './db.js?v=8';
import {
  el, section, notFound, formField, formSelect, formTextarea,
  catBadge, focusTagEl, uid, toast, confirmModal, openPicker,
  DAY_ORDER, DAY_LABELS,
} from './ui.js?v=8';

const FOCUS_TAGS = ['push', 'pull', 'legs', 'upper', 'core', 'rehab', 'cardio', 'recovery'];

export async function renderRoutineEditor(container, existing) {
  const isEdit = !!existing;
  const allExercises = await db.getAll('exercises');
  const exById = new Map(allExercises.map((e) => [e.id, e]));

  const model = isEdit ? JSON.parse(JSON.stringify(existing)) : {
    id: uid('rt'),
    name: '',
    folderName: 'Custom',
    scheduledDay: null,
    focusTags: [],
    exercises: [],
    isActive: true,
    createdAt: new Date().toISOString(),
  };

  container.appendChild(el('section', { class: 'hero' }, [
    el('div', { class: 'eyebrow' }, [
      el('a', { href: isEdit ? `#/routine/${model.id}` : '#/plan', class: 'crumb', text: '‹ CANCEL' }),
      el('span', { text: '  ·  ' + (isEdit ? 'EDITING' : 'NEW ROUTINE') }),
    ]),
    el('h1', { text: isEdit ? 'EDIT ROUTINE' : 'CREATE ROUTINE' }),
  ]));

  // Basic info form
  const form = el('div', { class: 'form-stack' });
  form.appendChild(formField('NAME', 'text', 'name', model.name, 'e.g. Mon: Push + Core'));
  form.appendChild(formField('FOLDER (OPTIONAL)', 'text', 'folderName', model.folderName || '', 'e.g. Weekly Program'));
  form.appendChild(formSelect('SCHEDULED DAY', 'scheduledDay', model.scheduledDay || '', [
    { value: '', label: 'UNSCHEDULED' },
    ...DAY_ORDER.map((d) => ({ value: d, label: DAY_LABELS[d] })),
  ]));
  container.appendChild(section('DETAILS', form));

  // Focus tag toggles
  const tagRow = el('div', { class: 'filter-row' });
  const activeTags = new Set(model.focusTags || []);
  const tagChips = new Map();
  for (const t of FOCUS_TAGS) {
    const chip = el('button', { class: 'filter-chip' + (activeTags.has(t) ? ' filter-chip-active' : ''), text: t.toUpperCase() });
    chip.addEventListener('click', () => {
      if (activeTags.has(t)) activeTags.delete(t); else activeTags.add(t);
      chip.classList.toggle('filter-chip-active');
      model.focusTags = [...activeTags];
    });
    tagRow.appendChild(chip);
    tagChips.set(t, chip);
  }
  container.appendChild(section('FOCUS TAGS', tagRow));

  // Exercises editor
  const exSection = el('div', {});
  container.appendChild(el('section', { class: 'section' }, [
    el('div', { class: 'section-label', id: 'ex-section-label' }),
    exSection,
  ]));

  function renderExercises() {
    exSection.innerHTML = '';
    document.getElementById('ex-section-label').textContent = `EXERCISES  ·  ${model.exercises.length}`;
    if (model.exercises.length === 0) {
      exSection.appendChild(el('div', { class: 'empty-note', text: 'NO EXERCISES YET  ·  TAP + ADD BELOW' }));
    } else {
      const list = el('div', { class: 'exercise-list' });
      model.exercises.forEach((ex, i) => list.appendChild(editableExerciseRow(model, ex, i, exById, renderExercises)));
      exSection.appendChild(list);
    }
  }
  renderExercises();

  container.appendChild(section('ADD',
    el('button', { class: 'btn btn-primary', onclick: () => openExercisePicker(allExercises, model, renderExercises) }, [
      el('span', { class: 'btn-title', text: '+ ADD EXERCISE FROM LIBRARY' }),
      el('span', { class: 'btn-sub', text: 'PICK ONE OR MORE FROM YOUR EXERCISE LIBRARY' }),
    ])
  ));

  // Save / delete
  const saveBtn = el('button', { class: 'btn btn-primary' }, [
    el('span', { class: 'btn-title', text: isEdit ? 'SAVE CHANGES' : 'CREATE ROUTINE' }),
    el('span', { class: 'btn-sub', text: isEdit ? 'UPDATE THIS ROUTINE' : 'ADDS TO YOUR PROGRAM' }),
  ]);
  saveBtn.addEventListener('click', async () => {
    model.name = form.querySelector('[name="name"]').value.trim();
    model.folderName = form.querySelector('[name="folderName"]').value.trim() || null;
    model.scheduledDay = form.querySelector('[name="scheduledDay"]').value || null;
    model.updatedAt = new Date().toISOString();
    if (!model.name) { toast('NAME REQUIRED', 'error'); return; }
    try {
      await db.put('routines', model);
      toast(isEdit ? 'ROUTINE SAVED' : `CREATED · ${model.name}`, 'ok');
      window.location.hash = `#/routine/${model.id}`;
    } catch (err) { console.error(err); toast('SAVE FAILED · ' + err.message, 'error'); }
  });

  const actions = [saveBtn];
  actions.push(el('a', { class: 'btn btn-outline', href: isEdit ? `#/routine/${model.id}` : '#/plan' }, [
    el('span', { class: 'btn-title', text: 'CANCEL' }),
    el('span', { class: 'btn-sub', text: 'DISCARD CHANGES' }),
  ]));
  if (isEdit) {
    actions.push(el('button', { class: 'btn btn-danger', onclick: () => onDeleteRoutine(model) }, [
      el('span', { class: 'btn-title', text: 'DELETE ROUTINE' }),
      el('span', { class: 'btn-sub', text: 'PERMANENT · CANNOT BE UNDONE' }),
    ]));
  }
  container.appendChild(section('SAVE', el('div', { class: 'action-stack' }, actions)));
}

function editableExerciseRow(model, ex, idx, exById, rerender) {
  const libEx = exById.get(ex.exerciseId);
  const row = el('div', { class: 'edit-exercise-row' });

  row.appendChild(el('div', { class: 'edit-ex-header' }, [
    el('div', { class: 'exercise-num', text: idx + 1 }),
    catBadge(libEx?.category || 'strength'),
    el('div', { class: 'edit-ex-name', text: ex.exerciseName || libEx?.name || '(deleted)' }),
    el('div', { class: 'edit-ex-controls' }, [
      el('button', { class: 'edit-btn', text: '↑', onclick: () => moveExercise(model, idx, -1, rerender) }),
      el('button', { class: 'edit-btn', text: '↓', onclick: () => moveExercise(model, idx, 1, rerender) }),
      el('button', { class: 'edit-btn edit-btn-danger', text: '×', onclick: () => removeExercise(model, idx, rerender) }),
    ]),
  ]));

  // Sets editor
  const setsWrap = el('div', { class: 'edit-sets-wrap' });
  (ex.sets || []).forEach((set, si) => setsWrap.appendChild(editableSetRow(ex, set, si, rerender)));
  row.appendChild(setsWrap);

  const setActions = el('div', { class: 'set-actions' }, [
    el('button', { class: 'set-btn', text: '+ SET', onclick: () => addSet(ex, rerender) }),
    el('button', { class: 'set-btn set-btn-danger', text: '− SET', onclick: () => removeSet(ex, rerender) }),
  ]);
  row.appendChild(setActions);

  // Rest between sets
  const restRow = el('div', { class: 'form-field', style: 'margin-top: 10px;' }, [
    el('span', { class: 'form-label', text: 'REST BETWEEN SETS (SECONDS)' }),
    el('input', {
      class: 'form-input', type: 'number', value: ex.restBetweenSets || '',
      placeholder: '60',
      onchange: (e) => { ex.restBetweenSets = e.target.value ? Number(e.target.value) : null; },
    }),
  ]);
  row.appendChild(restRow);

  return row;
}

function editableSetRow(ex, set, si, rerender) {
  const isDuration = set.durationSec != null;
  const row = el('div', { class: 'edit-set-row' }, [
    el('div', { class: 'edit-set-num', text: `${si + 1}` }),
  ]);
  if (isDuration) {
    row.appendChild(el('div', { class: 'edit-set-fields' }, [
      el('input', {
        class: 'form-input edit-set-input', type: 'number', value: set.durationSec || '', placeholder: 'sec',
        onchange: (e) => { set.durationSec = e.target.value ? Number(e.target.value) : null; },
      }),
      el('span', { class: 'edit-set-unit', text: 'S' }),
    ]));
  } else {
    row.appendChild(el('div', { class: 'edit-set-fields' }, [
      el('input', {
        class: 'form-input edit-set-input', type: 'number', value: set.reps ?? '', placeholder: 'reps',
        onchange: (e) => { set.reps = e.target.value ? Number(e.target.value) : null; },
      }),
      el('span', { class: 'edit-set-x', text: '×' }),
      el('input', {
        class: 'form-input edit-set-input', type: 'number', step: '0.5', value: set.weightLb ?? '', placeholder: 'lb',
        onchange: (e) => { set.weightLb = e.target.value ? Number(e.target.value) : null; },
      }),
      el('span', { class: 'edit-set-unit', text: 'LB' }),
    ]));
  }
  return row;
}

function moveExercise(model, idx, delta, rerender) {
  const newIdx = idx + delta;
  if (newIdx < 0 || newIdx >= model.exercises.length) return;
  const [item] = model.exercises.splice(idx, 1);
  model.exercises.splice(newIdx, 0, item);
  rerender();
}
function removeExercise(model, idx, rerender) {
  confirmModal('REMOVE EXERCISE?', 'Remove this exercise from the routine? Not saved until you tap SAVE at the bottom.', async () => {
    model.exercises.splice(idx, 1); rerender();
  });
}
function addSet(ex, rerender) {
  const last = (ex.sets || [])[ex.sets.length - 1];
  const newSet = last ? { ...last } : { type: 'normal', reps: null, weightLb: null, durationSec: null };
  ex.sets.push(newSet);
  rerender();
}
function removeSet(ex, rerender) {
  if ((ex.sets || []).length === 0) return;
  ex.sets.pop(); rerender();
}

function openExercisePicker(allExercises, model, rerender) {
  const sorted = [...allExercises].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const items = sorted.map((ex) => ({ label: `${(ex.category || '?').slice(0,1).toUpperCase()} · ${ex.name}`, id: ex.id, ex }));
  openPicker('ADD EXERCISE', items, (item) => {
    const ex = item.ex;
    const isCardio = ex.category === 'cardio';
    model.exercises.push({
      exerciseId: ex.id,
      exerciseName: ex.name,
      order: model.exercises.length,
      restBetweenSets: null,
      supersetGroupId: null,
      notes: '',
      sets: isCardio
        ? [{ type: 'normal', durationSec: 1500, reps: null, weightLb: null }]
        : [{ type: 'normal', reps: 10, weightLb: null, durationSec: null }],
    });
    rerender();
    toast(`ADDED · ${ex.name}`, 'ok');
  });
}

function onDeleteRoutine(routine) {
  confirmModal('DELETE ROUTINE?', 'Permanently delete this routine. Cannot be undone.', async () => {
    try { await db.remove('routines', routine.id); toast(`DELETED · ${routine.name}`, 'ok'); window.location.hash = '#/plan'; }
    catch (err) { console.error(err); toast('DELETE FAILED · ' + err.message, 'error'); }
  });
}
