# Gym Tracker

A local workout tracker: a FastAPI + SQLite backend with a React frontend. It runs on your own machine only, so
there's no login.

## Run it

```powershell
.\run.ps1
```

This sets up the Python environment and frontend packages the first time, builds the frontend, and opens
<http://127.0.0.1:8100>. Your data is stored in `backend/gym.db`.

For development, `.\run.ps1 -Dev` starts the API with auto-reload on port 8100 and the Vite dev server with hot
reload on <http://localhost:5173>.

Use `.\run.ps1 -Port 8200` (or any free port) if 8100 is taken.

Requires Python 3.12+ and Node 20+.

## Bringing over data from the old browser version

1. Open the old app (`index.html` at the repo root) in the browser you used it in.
2. **Data → Export all data (JSON)**.
3. In the new app, **Data → Import data (JSON)** and pick that file.

The import tells you about anything it had to adjust. For example, if the same person appears twice in one
session, the second one is imported as "Name (2)" so you can rename or merge it under **People**.

## Layout

| Path | What |
|---|---|
| `backend/app/models.py` | Database tables: people, exercises, sessions → participants → entries → sets, set bands, targets, inventory |
| `backend/app/routers/` | REST API (`/api/...`); interactive docs at <http://127.0.0.1:8100/docs> |
| `backend/app/stats.py` | PRs, best at N reps, estimated 1RM (Epley, best sets at 2–6 reps) |
| `backend/app/routers/data.py` | JSON export/import, compatible with the old app's format (and the Power BI report) |
| `backend/tests/` | API tests: `backend\.venv\Scripts\python -m pytest backend/tests` |
| `frontend/src/` | React app (Vite + TypeScript) |

People and exercises are first-class records: renaming one updates every session, and **Merge** (in the People
and Exercises sections) folds duplicates together. A person can only appear once per session, and only one session
is active at a time.
