# FORGE

Personal strength & recovery tracker. Web-app / PWA. All data stays on your device.

## Phase 1 · Foundation (this build)

- IndexedDB storage layer with 8 object stores.
- Design system tokens (colors, typography, layout).
- PWA-ready (installable to iPhone / Mac home screen).
- Auto-imports your bundled Hevy backup on first launch.
- Export any-time backup to JSON.
- Import backup from a JSON file (FORGE or Hevy format).
- Clear-all-data with confirm.
- Live storage-usage readout.

Phase 2 adds the workout loop (exercise library, routine editor, program, execution, history).

## Run locally

Any static file server works. From this folder:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000` in a browser.

Service workers require HTTPS or `localhost`. `file://` will not work.

## Deploy to GitHub Pages

1. Create a new empty repo on GitHub (e.g. `forge`).
2. From this folder:
   ```bash
   git init
   git remote add origin git@github.com:YOUR-USERNAME/forge.git
   git add .
   git commit -m "Phase 1"
   git branch -M main
   git push -u origin main
   ```
3. In the repo settings → Pages → **Source: Deploy from a branch** → **Branch: main / (root)** → Save.
4. Wait a minute, then visit `https://YOUR-USERNAME.github.io/forge/`.

Add to iPhone home screen from Safari (Share → Add to Home Screen). Icon and standalone display are already configured.

## First launch

The app detects an empty database and imports `data/hevy-backup.json` automatically. You'll see a toast confirming what loaded, then the Vault screen with counts:

- 47+ exercises (Hevy templates + custom rehab exercises)
- 18 routines (weekly program + leg rehab folder + legacy)
- 37 body measurements (Aug 2025 → Jul 2026)
- Goals: Inca Trail, weight target, push-up target
- Settings: units, stride length, step goal, constraints

## Backup discipline

Export to Drive / iCloud after any meaningful change. The Vault screen shows a monthly reminder (Phase 4). Until then, back up manually.

## Data model

All records live in IndexedDB (`forge` database, version 1). Object stores:

- `exercises` · your active library
- `routines` · reusable workout templates
- `sessions` · completed workouts (snapshotted)
- `bodyMeasurements` · one row per date
- `dailyActivity` · one row per date (steps, distance)
- `goals` · events, milestones, progression phases
- `settings` · key/value app config
- `meta` · import/restore audit trail

Full schema in `js/import.js`.

## Files

```
forge/
├── index.html                       Main entry
├── manifest.webmanifest             PWA manifest
├── sw.js                            Service worker (offline)
├── css/app.css                      Design tokens + component styles
├── js/
│   ├── app.js                       Boot + UI wiring
│   ├── db.js                        IndexedDB wrapper
│   ├── import.js                    Hevy backup importer
│   └── export.js                    Backup export + restore
├── data/hevy-backup.json            Seed data (auto-imports on first run)
└── icons/                           App icons (SVG + PNG)
```

## Notes

- Weight stored in lb internally. Hevy import converts kg → lb automatically.
- Distance stored in miles internally. Hevy import converts meters → mi automatically.
- Stride length default is 30 in (change in Phase 4 Settings).
- No analytics, no telemetry, no server calls. Ever.
