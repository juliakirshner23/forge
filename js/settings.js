// FORGE settings editor
import * as db from './db.js?v=28';
import { el, section, formField, formSelect, toast, confirmModal } from './ui.js?v=28';
import { DEFAULT_CALIBRATION, DEFAULT_STEP_BONUS, STEP_THRESHOLD, setPaused, isPaused, localIso } from './trail.js?v=28';

export async function renderSettings(container) {
  const [units, stride, stepGoal, prompts, backup, profile, constraints, calorieBudget, netCalorieGoal, theme] = await Promise.all([
    db.getSetting('units'), db.getSetting('strideLengthIn'), db.getSetting('stepGoal'),
    db.getSetting('promptSensitivity'), db.getSetting('backupReminder'),
    db.getSetting('profile'), db.getSetting('constraints'),
    db.getSetting('calorieBudget'), db.getSetting('netCalorieGoal'),
    db.getSetting('theme'),
  ]);
  const [calibration, stepBonus, stairStep, pauses] = await Promise.all([
    db.getSetting('hrCalibration', DEFAULT_CALIBRATION), db.getSetting('stepBonusPoints', DEFAULT_STEP_BONUS),
    db.getSetting('stairStepHeightIn', null), db.getSetting('trailPauses', []),
  ]);

  container.appendChild(el('section', { class: 'hero' }, [
    el('div', { class: 'eyebrow' }, [
      el('a', { href: '#/home', class: 'crumb', text: '‹ TODAY' }),
      el('span', { text: '  ·  SETTINGS AND DATA' }),
    ]),
    el('h1', { text: 'ME' }),
  ]));

  // v0.9.0 · Trail: heart rate calibration, step bonus, Stairmaster step height
  const calRows = calibration.map((r) => ({ ...r }));
  const calWrap = el('div', { class: 'cal-table' });
  function renderCal() {
    calWrap.innerHTML = '';
    calWrap.appendChild(el('div', { class: 'cal-row cal-head' }, [
      el('span', { text: 'INCLINE %' }), el('span', { text: 'HEART RATE (BPM)' }), el('span', { text: '' }),
    ]));
    calRows.forEach((r, i) => {
      const inc = el('input', { class: 'form-input', type: 'number', step: '0.5', value: r.incline ?? '', placeholder: '%' });
      const bpm = el('input', { class: 'form-input', type: 'number', step: '1', value: r.bpm ?? '', placeholder: 'bpm' });
      inc.addEventListener('input', () => { r.incline = inc.value === '' ? null : Number(inc.value); });
      bpm.addEventListener('input', () => { r.bpm = bpm.value === '' ? null : Number(bpm.value); });
      const del = el('button', { class: 'edit-btn edit-btn-danger', text: '×', onclick: () => { calRows.splice(i, 1); renderCal(); } });
      calWrap.appendChild(el('div', { class: 'cal-row' }, [inc, bpm, del]));
    });
    calWrap.appendChild(el('button', { class: 'set-btn', text: '+ ADD INCLINE', onclick: () => { calRows.push({ incline: null, bpm: null }); renderCal(); } }));
  }
  renderCal();
  const trailForm = el('div', { class: 'form-stack' }, [
    el('div', { class: 'form-hint', text: 'TREADMILL AT 3.0 MPH. ELLIPTICAL, BIKE, ROWER, AND STRENGTH CLIMB CREDIT USE THIS TABLE. ABOVE YOUR HIGHEST ROW, CREDIT CAPS AT THAT INCLINE. CHANGES APPLY TO NEW SESSIONS ONLY.' }),
    calWrap,
    formField(`STEP BONUS POINTS (${STEP_THRESHOLD.toLocaleString()}+ STEPS, ALL OR NOTHING)`, 'number', 'stepBonus', stepBonus ?? DEFAULT_STEP_BONUS, 'e.g. 30'),
    formField('STAIRMASTER STEP HEIGHT (IN)', 'number', 'stairStep', stairStep ?? '', 'MEASURE ONE STEP · NEEDED FOR STAIRMASTER CLIMB', { step: '0.1' }),
    el('div', { class: 'form-hint', text: 'STRENGTH SESSIONS EARN 1/4 CREDIT. DAILY STEPS NEVER MOVE YOU ON THE TRAIL.' }),
  ]);
  async function saveTrailSettings() {
    const cleanCal = calRows.filter((r) => r.incline != null && r.bpm != null && r.bpm > 0 && r.incline >= 0)
      .sort((a, b) => a.incline - b.incline);
    await db.setSetting('hrCalibration', cleanCal);
    const sb = trailForm.querySelector('[name="stepBonus"]').value;
    await db.setSetting('stepBonusPoints', sb === '' ? DEFAULT_STEP_BONUS : Number(sb));
    const sh = trailForm.querySelector('[name="stairStep"]').value;
    await db.setSetting('stairStepHeightIn', sh === '' ? null : Number(sh));
  }
  trailForm.appendChild(el('button', { class: 'btn btn-primary', onclick: async () => {
    try { await saveTrailSettings(); toast('TRAIL SETTINGS SAVED', 'ok'); }
    catch (err) { console.error(err); toast('SAVE FAILED · ' + err.message, 'error'); }
  } }, [ el('span', { class: 'btn-title', text: 'SAVE TRAIL SETTINGS' }) ]));
  container.appendChild(section('TRAIL · CLIMB CALIBRATION', trailForm));

  // Pause: applies immediately (no save needed)
  const pausedNow = isPaused(localIso(new Date()), pauses);
  const pauseBtn = el('button', { class: pausedNow ? 'btn btn-primary' : 'btn btn-outline' }, [
    el('span', { class: 'btn-title', text: pausedNow ? 'RESUME TRAIL' : 'PAUSE TRAIL' }),
    el('span', { class: 'btn-sub', text: pausedNow
      ? `PAUSED SINCE ${pauses.find((p) => p.end == null)?.start || ''} · TAP TO RESUME TODAY`
      : 'NO SKIP PENALTIES · STREAK HELD · DISTANCE, CLIMB, POINTS, BADGES KEPT' }),
  ]);
  pauseBtn.addEventListener('click', () => {
    confirmModal(pausedNow ? 'RESUME TRAIL?' : 'PAUSE TRAIL?',
      pausedNow ? 'Progress counting restarts today.' : 'Nothing counts and nothing is lost until you resume. Workouts logged while paused earn no trail credit.',
      async () => { await setPaused(!pausedNow); toast(pausedNow ? 'TRAIL RESUMED' : 'TRAIL PAUSED', 'ok'); const m = await import('./app.js?v=28'); m.refresh && m.refresh(); });
  });
  container.appendChild(section('TRAIL · PAUSE', pauseBtn));

  // Profile
  const profileForm = el('div', { class: 'form-stack' });
  profileForm.appendChild(formField('YOUR NAME', 'text', 'profileName', profile?.name || '', 'e.g. Julia'));
  container.appendChild(section('PROFILE', profileForm));

  // Units
  const unitsForm = el('div', { class: 'form-stack' });
  unitsForm.appendChild(formSelect('WEIGHT', 'weightUnit', units?.weight || 'lb', [
    { value: 'lb', label: 'POUNDS (LB)' }, { value: 'kg', label: 'KILOGRAMS (KG)' },
  ]));
  unitsForm.appendChild(formSelect('DISTANCE', 'distanceUnit', units?.distance || 'mi', [
    { value: 'mi', label: 'MILES (MI)' }, { value: 'km', label: 'KILOMETERS (KM)' },
  ]));
  unitsForm.appendChild(formSelect('BODY MEASUREMENT', 'measurementUnit', units?.measurement || 'in', [
    { value: 'in', label: 'INCHES (IN)' }, { value: 'cm', label: 'CENTIMETERS (CM)' },
  ]));
  container.appendChild(section('UNITS', unitsForm));

  // Activity
  const activityForm = el('div', { class: 'form-stack' });
  activityForm.appendChild(formField('STRIDE LENGTH (IN)', 'number', 'stride', stride ?? 30, 'AUTO-CALCS DISTANCE FROM STEPS'));
  activityForm.appendChild(formField('DAILY STEP GOAL', 'number', 'stepGoal', stepGoal ?? 10000, 'e.g. 10000'));
  container.appendChild(section('ACTIVITY', activityForm));

  // Prompts + backups
  const prefsForm = el('div', { class: 'form-stack' });
  prefsForm.appendChild(formSelect('PROGRESSION PROMPT SENSITIVITY', 'prompts', prompts || 'balanced', [
    { value: 'aggressive', label: 'AGGRESSIVE · SUGGEST INCREASES OFTEN' },
    { value: 'balanced', label: 'BALANCED · DEFAULT' },
    { value: 'conservative', label: 'CONSERVATIVE · WAIT FOR CLEAR PROGRESS' },
  ]));
  prefsForm.appendChild(formSelect('BACKUP REMINDER', 'backup', backup || 'monthly', [
    { value: 'weekly', label: 'WEEKLY' }, { value: 'monthly', label: 'MONTHLY' }, { value: 'never', label: 'NEVER' },
  ]));
  container.appendChild(section('PREFERENCES', prefsForm));

  // Appearance
  const themeForm = el('div', { class: 'form-stack' });
  themeForm.appendChild(formSelect('THEME', 'theme', theme || 'light', [
    { value: 'light', label: 'LIGHT · IVORY + AMBER (DEFAULT)' },
    { value: 'dark',  label: 'DARK · BLACK + AMBER' },
  ]));
  container.appendChild(section('APPEARANCE', themeForm));

  // Notifications
  const notifForm = el('div', { class: 'form-stack' });
  notifForm.appendChild(el('div', { class: 'form-hint', text: 'MONTHLY BACKUP REMINDER USES BROWSER NOTIFICATIONS. iOS SAFARI PWA SUPPORT IS LIMITED.' }));
  const notifBtn = el('button', { class: 'btn btn-outline' }, [
    el('span', { class: 'btn-title', text: 'ENABLE NOTIFICATIONS' }),
    el('span', { class: 'btn-sub', text: 'ONE-TIME PERMISSION PROMPT' }),
  ]);
  notifBtn.addEventListener('click', async () => {
    if (!('Notification' in window)) { toast('NOTIFICATIONS NOT SUPPORTED', 'error'); return; }
    const r = await Notification.requestPermission();
    if (r === 'granted') toast('NOTIFICATIONS ENABLED', 'ok');
    else toast('PERMISSION ' + r.toUpperCase(), 'error');
  });
  notifForm.appendChild(notifBtn);
  container.appendChild(section('NOTIFICATIONS', notifForm));

  // Calories
  const calForm = el('div', { class: 'form-stack' });
  calForm.appendChild(formField('DAILY BUDGET (KCAL)', 'number', 'calorieBudget', calorieBudget ?? 2000, 'MAX FOOD CALORIES PER DAY'));
  calForm.appendChild(formField('NET CALORIE GOAL (KCAL)', 'number', 'netCalorieGoal', netCalorieGoal ?? 1800, 'FOOD MINUS EXERCISE TARGET'));
  container.appendChild(section('CALORIES', calForm));

  // Constraints
  const conForm = el('div', { class: 'form-stack' });
  conForm.appendChild(formSelect('CONSTRAINTS ACTIVE', 'conActive', String(constraints?.active ?? false), [
    { value: 'true', label: 'YES · PT REHAB MODE' }, { value: 'false', label: 'NO · UNRESTRICTED' },
  ]));
  conForm.appendChild(formField('CONSTRAINT SUMMARY', 'text', 'conSummary', constraints?.summary || '', 'e.g. Leg injury · PT rehab only'));
  conForm.appendChild(formField('PT CLEARANCE EXPECTED', 'date', 'conClearance', constraints?.clearanceExpected || '', ''));
  container.appendChild(section('CONSTRAINTS', conForm));

  // Save button
  const saveBtn = el('button', { class: 'btn btn-primary' }, [
    el('span', { class: 'btn-title', text: 'SAVE ALL SETTINGS' }),
    el('span', { class: 'btn-sub', text: 'APPLIES IMMEDIATELY' }),
  ]);
  saveBtn.addEventListener('click', async () => {
    try {
      const name = profileForm.querySelector('[name="profileName"]').value.trim();
      await db.setSetting('profile', { name });
      await db.setSetting('units', {
        weight: unitsForm.querySelector('[name="weightUnit"]').value,
        distance: unitsForm.querySelector('[name="distanceUnit"]').value,
        measurement: unitsForm.querySelector('[name="measurementUnit"]').value,
      });
      await db.setSetting('strideLengthIn', Number(activityForm.querySelector('[name="stride"]').value) || 30);
      await db.setSetting('stepGoal', Number(activityForm.querySelector('[name="stepGoal"]').value) || 10000);
      await db.setSetting('promptSensitivity', prefsForm.querySelector('[name="prompts"]').value);
      await db.setSetting('backupReminder', prefsForm.querySelector('[name="backup"]').value);
      await db.setSetting('calorieBudget', Number(calForm.querySelector('[name="calorieBudget"]').value) || 2000);
      await db.setSetting('netCalorieGoal', Number(calForm.querySelector('[name="netCalorieGoal"]').value) || 1800);
      const newTheme = themeForm.querySelector('[name="theme"]').value;
      await db.setSetting('theme', newTheme);
      document.documentElement.setAttribute('data-theme', newTheme);
      await saveTrailSettings();
      const conActive = conForm.querySelector('[name="conActive"]').value === 'true';
      await db.setSetting('constraints', {
        active: conActive,
        summary: conForm.querySelector('[name="conSummary"]').value.trim(),
        flags: constraints?.flags || ['weight-bearing', 'plank', 'heavy-legs', 'standing-under-load'],
        clearanceExpected: conForm.querySelector('[name="conClearance"]').value || null,
      });
      toast('SETTINGS SAVED', 'ok');
    } catch (err) { console.error(err); toast('SAVE FAILED · ' + err.message, 'error'); }
  });
  container.appendChild(section('SAVE', el('div', { class: 'action-stack' }, [saveBtn])));

  // v1.0.0 · Group in a logical order: profile, targets, trail, training, app.
  const ORDER = ['PROFILE', 'UNITS', 'ACTIVITY', 'CALORIES', 'TRAIL · CLIMB CALIBRATION', 'TRAIL · PAUSE', 'CONSTRAINTS', 'PREFERENCES', 'APPEARANCE', 'NOTIFICATIONS', 'SAVE'];
  const secs = [...container.children].filter((n) => n.matches && n.matches('section.section'));
  const label = (n) => (n.querySelector(':scope > .section-label')?.textContent || '').trim().toUpperCase();
  secs.sort((a, b) => ORDER.indexOf(label(a)) - ORDER.indexOf(label(b)));
  for (const n of secs) container.appendChild(n);
  // Light theme only now; the appearance switch is gone.
  secs.filter((n) => label(n) === 'APPEARANCE').forEach((n) => n.remove());
}
