// FORGE settings editor
import * as db from './db.js?v=13';
import { el, section, formField, formSelect, toast } from './ui.js?v=13';

export async function renderSettings(container) {
  const [units, stride, stepGoal, prompts, backup, profile, constraints, calorieBudget, netCalorieGoal, theme] = await Promise.all([
    db.getSetting('units'), db.getSetting('strideLengthIn'), db.getSetting('stepGoal'),
    db.getSetting('promptSensitivity'), db.getSetting('backupReminder'),
    db.getSetting('profile'), db.getSetting('constraints'),
    db.getSetting('calorieBudget'), db.getSetting('netCalorieGoal'),
    db.getSetting('theme'),
  ]);

  container.appendChild(el('section', { class: 'hero' }, [
    el('div', { class: 'eyebrow' }, [
      el('a', { href: '#/me', class: 'crumb', text: '‹ ME' }),
      el('span', { text: '  ·  EDITABLE' }),
    ]),
    el('h1', { text: 'SETTINGS' }),
  ]));

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
  themeForm.appendChild(formSelect('THEME', 'theme', theme || 'dark', [
    { value: 'dark',  label: 'DARK · BLACK + AMBER (DEFAULT)' },
    { value: 'light', label: 'LIGHT · IVORY + AMBER' },
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
}
