// FORGE routine editor
import * as db from './db.js?v=31';
import {
  el, section, notFound, formField, formSelect, formTextarea,
  catBadge, focusTagEl, routineTags, uid, toast, confirmModal, openPicker, todayIso,
} from './ui.js?v=31';
import { PHASES, currentPhase, routineEntryFromBlock } from './program.js?v=31';

export async function renderRoutineEditor(container, existing, phaseIdForNew) {
  const isEdit = !!existing;
  const allExercises = await db.getAll('exercises');
  const exById = new Map(allExercises.map((e) => [e.id, e]));

  const model = isEdit ? JSON.parse(JSON.stringify(existing)) : {
    id: uid('rt'),
    name: '',
    folderName: null,
    phaseId: phaseIdForNew || currentPhase(todayIso()).id,
    scheduleDays: [],
    scheduleDates: [],
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
  form.appendChild(formField('NAME', 'text', 'name', model.name, 'e.g. Pull + Core'));
  form.appendChild(formSelect('PHASE', 'phaseId', model.phaseId || '', [
    ...PHASES.map((p) => ({ value: p.id, label: `${p.name} · ${p.dates}` })),
    { value: '', label: 'NO PHASE (ANY TIME)' },
  ]));
  container.appendChild(section('DETAILS', form));
  container.appendChild(el('div', { class: 'form-hint', style: 'margin: -8px 20px 16px;', text: 'CATEGORY TAGS COME FROM THE EXERCISES. PUT IT ON A DAY WITH "ADD TO DAY" AFTER SAVING.' }));

  // Exercises editor
  const exSection = el('div', {});
  const exLabel = el('div', { class: 'section-label', id: 'ex-section-label' });
  container.appendChild(el('section', { class: 'section' }, [
    exLabel,
    exSection,
  ]));

  function renderExercises() {
    exSection.innerHTML = '';
    exLabel.textContent = `EXERCISES  ·  ${model.exercises.length}`;
    if (model.exercises.length === 0) {
      exSection.appendChild(el('div', { class: 'empty-note', text: 'NO EXERCISES YET  ·  TAP + ADD BELOW' }));
    } else {
      const list = el('div', { class: 'exercise-list' });
      model.exercises.forEach((ex, i) => list.appendChild(editableExerciseRow(model, ex, i, exById, renderExercises)));
      exSection.appendChild(list);
    }
  }
  renderExercises();

  const fromBlocks = el('button', { class: 'btn btn-primary' }, [
    el('span', { class: 'btn-title', text: '+ ADD FROM BLOCKS' }),
    el('span', { class: 'btn-sub', text: 'TICK EXERCISES FROM PULL, LEGS, PUSH, CORE, CARDIO' }),
  ]);
  fromBlocks.addEventListener('click', async () => {
    const { openBlockPicker } = await import('./plan.js?v=31');
    const ph = form.querySelector('[name="phaseId"]').value || currentPhase(todayIso()).id;
    openBlockPicker(ph, (entries) => {
      for (const e of entries) {
        if (!e.exerciseId) continue;
        model.exercises.push(routineEntryFromBlock(e, model.exercises.length));
      }
      renderExercises();
      toast(`ADDED ${entries.length} EXERCISE${entries.length === 1 ? '' : 'S'}`, 'ok');
    });
  });
  container.appendChild(section('ADD', el('div', { class: 'action-stack' }, [
    fromBlocks,
    el('button', { class: 'btn btn-outline', onclick: () => addExerciseToRoutine(model, renderExercises, exById) }, [
      el('span', { class: 'btn-title', text: '+ ADD FROM LIBRARY' }),
      el('span', { class: 'btn-sub', text: 'ANY EXERCISE, OR CREATE A NEW ONE' }),
    ]),
  ])));

  // Save / delete
  const saveBtn = el('button', { class: 'btn btn-primary' }, [
    el('span', { class: 'btn-title', text: isEdit ? 'SAVE CHANGES' : 'CREATE ROUTINE' }),
    el('span', { class: 'btn-sub', text: isEdit ? 'UPDATE THIS ROUTINE' : 'ADDS TO YOUR PROGRAM' }),
  ]);
  saveBtn.addEventListener('click', async () => {
    model.name = form.querySelector('[name="name"]').value.trim();
    model.phaseId = form.querySelector('[name="phaseId"]').value || null;
    model.exercises.forEach((e, i) => { e.order = i; });
    model.focusTags = routineTags(model, exById);
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
    catBadge(libEx || "other"),
    el('div', { class: 'edit-ex-name', text: ex.exerciseName || libEx?.name || '(deleted)' }),
    el('div', { class: 'edit-ex-controls' }, [
      el('button', { class: 'edit-btn', text: '↑', onclick: () => moveExercise(model, idx, -1, rerender) }),
      el('button', { class: 'edit-btn', text: '↓', onclick: () => moveExercise(model, idx, 1, rerender) }),
      el('button', { class: 'edit-btn edit-btn-danger', text: '×', onclick: () => removeExercise(model, idx, rerender) }),
    ]),
  ]));

  // Superset with previous exercise (except first)
  if (idx > 0) {
    const supRow = el('div', { class: 'form-field', style: 'margin-top: 8px;' }, [
      el('label', { class: 'superset-toggle' }, [
        el('input', { type: 'checkbox', checked: ex.supersetGroupId ? true : null, onchange: (e) => {
          if (e.target.checked) {
            const prev = model.exercises[idx - 1];
            ex.supersetGroupId = prev.supersetGroupId || ('ss_' + Math.random().toString(36).slice(2, 8));
            prev.supersetGroupId = ex.supersetGroupId;
          } else {
            ex.supersetGroupId = null;
          }
          rerender();
        } }),
        el('span', { class: 'form-label', text: '  SUPERSET WITH PREVIOUS' }),
      ]),
    ]);
    row.appendChild(supRow);
  }

  // Cardio grouping label (visual, non-exclusive)
  const isCardio = (libEx?.category === 'cardio');
  if (isCardio) {
    const groupInput = el('input', {
      class: 'form-input', type: 'text', placeholder: 'e.g. CARDIO-A (LEAVE BLANK IF SOLO)',
      value: ex.pickOneGroupId || '',
      onchange: (e) => { ex.pickOneGroupId = e.target.value.trim() || null; },
    });
    row.appendChild(el('div', { class: 'form-field', style: 'margin-top: 8px;' }, [
      el('span', { class: 'form-label', text: 'CARDIO GROUP · SAME LABEL = VISUAL ALTERNATIVES (LOG ANY OR ALL)' }),
      groupInput,
    ]));
  }

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

  // Exercise notes (planning)
  const notesRow = el('div', { class: 'form-field', style: 'margin-top: 10px;' }, [
    el('span', { class: 'form-label', text: 'EXERCISE NOTES' }),
    el('input', {
      class: 'form-input', type: 'text', value: ex.notes || '',
      placeholder: 'FORM CUE OR TARGET',
      onchange: (e) => { ex.notes = e.target.value.trim(); },
    }),
  ]);
  row.appendChild(notesRow);

  // Substitutes (up to 3)
  const subsWrap = el('div', { class: 'form-field', style: 'margin-top: 10px;' });
  subsWrap.appendChild(el('span', { class: 'form-label', text: 'SUBSTITUTES · SHOWN IN WORKOUT IF EQUIPMENT BUSY' }));
  const subsList = el('div', { class: 'subs-list' });
  const subIds = ex.substituteIds || [];
  for (const sid of subIds) {
    const s = exById.get(sid);
    if (!s) continue;
    subsList.appendChild(el('span', { class: 'sub-chip' }, [
      el('span', { text: s.name }),
      el('button', { class: 'sub-chip-x', text: '×', onclick: () => {
        ex.substituteIds = (ex.substituteIds || []).filter((x) => x !== sid); rerender();
      } }),
    ]));
  }
  subsWrap.appendChild(subsList);
  if (subIds.length < 3) {
    const addSubBtn = el('button', { class: 'btn btn-outline sub-add-btn', style: 'margin-top: 6px;' }, [
      el('span', { class: 'btn-title', text: '+ ADD SUBSTITUTE' }),
    ]);
    addSubBtn.addEventListener('click', () => {
      const otherExs = [...exById.values()].filter((e) => e.id !== ex.exerciseId && e.category === (libEx?.category || 'strength'));
      openPicker('ADD SUBSTITUTE', otherExs.map((e) => ({ label: e.name, id: e.id })), (item) => {
        ex.substituteIds = [...(ex.substituteIds || []), item.id]; rerender();
      });
    });
    subsWrap.appendChild(addSubBtn);
  }
  row.appendChild(subsWrap);

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
        class: 'form-input edit-set-input', type: 'number', step: '0.1',
        value: set.durationSec != null ? (set.durationSec / 60) : '',
        placeholder: 'min',
        onchange: (e) => { set.durationSec = e.target.value ? Math.round(Number(e.target.value) * 60) : null; },
      }),
      el('span', { class: 'edit-set-unit', text: 'MIN' }),
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

async function addExerciseToRoutine(model, rerender, exById) {
  const { openExercisePicker } = await import('./exercise-picker.js?v=31');
  openExercisePicker('ADD EXERCISE', (ex) => {
    exById.set(ex.id, ex);
    model.exercises.push(routineEntryFor(ex, model.exercises.length));
    rerender();
    toast(`ADDED · ${ex.name}`, 'ok');
  });
}

// Shape of one exercise inside a routine. Shared with the active workout's
// "save to routine" option.
export function routineEntryFor(ex, order) {
  const isCardio = ex.category === 'cardio';
  return {
    substituteIds: ex.substituteIds || [],
    exerciseId: ex.id,
    exerciseName: ex.name,
    order,
    restBetweenSets: null,
    supersetGroupId: null,
    notes: '',
    sets: isCardio
      ? [{ type: 'normal', durationSec: 1500, reps: null, weightLb: null }]
      : [{ type: 'normal', reps: 10, weightLb: null, durationSec: null }],
  };
}

function onDeleteRoutine(routine) {
  confirmModal('DELETE ROUTINE?', 'Permanently delete this routine. Cannot be undone.', async () => {
    try { await db.remove('routines', routine.id); toast(`DELETED · ${routine.name}`, 'ok'); window.location.hash = '#/plan'; }
    catch (err) { console.error(err); toast('DELETE FAILED · ' + err.message, 'error'); }
  });
}
