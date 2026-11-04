# Gym Tracker

A local workout tracker for logging training sessions, one or more people at a time. It has a FastAPI + SQLite
backend and a React frontend, and runs on your own machine only, so there's no login.

## Run it

```powershell
.\run.ps1
```

The first run sets up the Python environment and frontend packages. Every run builds the frontend and opens
<http://127.0.0.1:8100>. Press Ctrl+C to stop.

- `.\run.ps1 -Port 8200` uses another port if 8100 is taken.
- `.\run.ps1 -Dev` is for working on the code: the API runs with auto-reload and the Vite dev server with hot reload
  on <http://localhost:5173>.

Requires Python 3.12+ and Node 20+.

## Your data

Everything is stored in `backend/gym.db` (SQLite). It isn't in git, so back it up with **Data → Export all data
(JSON)**. **Data → Import data (JSON)** restores an export, either replacing everything or merging into what's
there. Sessions already imported from the same file are updated, not duplicated.

The export format is the same one the original browser-only version of this app used (schema version 4), so
`Gym tracker.pbix` and any scripts reading it keep working. That old version was removed after its data was moved
over. If you ever need it, it's in the git history up to commit `79c0144`.

## What it does

- **Sessions:** log one or more people side by side, with exercises, sets (reps, weight, RIR) and notes. Only one
  session is active at a time. Past sessions can be opened, edited, resumed or deleted, and people can be added to
  or removed from a session.
- **Equipment per exercise:** weight, barbell (with the plates per side to load), plates with no bar (e.g. a
  weighted plank, showing which plates make up the weight), dumbbell (×1 or ×2), resistance
  band (one or two bands, by type and colour) or bodyweight. Each exercise remembers what was used last time.
- **Cardio:** duration and distance with average speed and pace, in km or miles. Run and Walk are built in; add
  more activities (e.g. Cycle, Swim) in the Exercises section.
- **Records:** PRs, best lift lookup (best weight at 1–16 reps, estimated 1RM using Epley on the best sets at
  2–6 reps), targets with progress, and a PR helper for working weights at 50–100%.
- **Plates & bars:** bars, plates, dumbbells, kettlebells, accessories and resistance bands you own.
- **Exercises and People:** lists with history, rename (applies everywhere) and merge (folds duplicates together).
  A person can appear only once per session.
- **History:** every past session, filterable by person and exercise.

## Layout

| Path | What |
|---|---|
| `run.ps1` | Starts the app (see above) |
| `backend/app/models.py` | Database tables: people, exercises, sessions → participants → entries → sets, set bands, targets, inventory |
| `backend/app/routers/` | REST API under `/api`; interactive docs at <http://127.0.0.1:8100/docs> while running |
| `backend/app/stats.py` | PRs, best at N reps, estimated 1RM, target progress |
| `backend/app/routers/data.py` | JSON export/import |
| `backend/app/seed.py` | Starting inventory and cardio activities for a new database |
| `backend/tests/` | API tests: `backend\.venv\Scripts\python -m pytest backend/tests` |
| `frontend/src/` | React app (Vite + TypeScript); `components/` has one file per section |
| `Gym tracker.pbix` | Power BI report built on the JSON export |
| `forecast.py` | Standalone script: rep-max forecast from a pasted "best at N reps" table |
