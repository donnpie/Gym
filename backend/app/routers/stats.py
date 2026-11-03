from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session as Db

from .. import models as m
from .. import schemas as s
from ..db import get_db
from ..services import get_or_404
from ..stats import MAX_TABLE_REPS, EPS, SetRow, Stats, get_stats

router = APIRouter(prefix="/api", tags=["stats"])


def _best_at(r: SetRow | None) -> s.BestAt | None:
    return s.BestAt(weight_kg=r.weight_kg or 0, date=r.date, rir=r.rir) if r else None


@router.get("/stats/prs", response_model=list[s.PROut])
def all_prs(db: Db = Depends(get_db)):
    """Every person/exercise personal record, heaviest first."""
    stats = get_stats(db)
    people = dict(db.execute(select(m.Person.id, m.Person.name)).all())
    exercises = dict(db.execute(select(m.Exercise.id, m.Exercise.name)).all())
    out = []
    for pid, eid in stats.pairs():
        pr = stats.pr(pid, eid)
        if pr:
            out.append(s.PROut(person_id=pid, person=people[pid], exercise_id=eid,
                               exercise=exercises[eid], weight_kg=pr.weight_kg, reps=pr.reps))
    return sorted(out, key=lambda x: -x.weight_kg)


@router.get("/stats/best", response_model=s.BestTable)
def best_table(person_id: int, exercise_id: int, db: Db = Depends(get_db)):
    """Best weight at 1..16+ reps, plus the estimated 1RM."""
    stats = get_stats(db)
    rows = [s.BestRow(reps=r, best=_best_at(stats.best_at_reps(person_id, exercise_id, r)))
            for r in range(1, MAX_TABLE_REPS + 1)]
    return s.BestTable(rows=rows, est_1rm=stats.est_1rm(person_id, exercise_id))


# ---------- Targets ----------

def _target_out(t: m.Target, stats: Stats, people: dict, exercises: dict) -> s.TargetOut:
    best = stats.best_at_reps(t.person_id, t.exercise_id, t.reps)
    achieved = bool(best and (best.weight_kg or 0) >= t.weight_kg - EPS)
    single = stats.best_at_reps(t.person_id, t.exercise_id, 1)
    return s.TargetOut(
        id=t.id, person_id=t.person_id, person=people[t.person_id],
        exercise_id=t.exercise_id, exercise=exercises[t.exercise_id],
        weight_kg=t.weight_kg, reps=t.reps, set_at=t.set_at,
        best=_best_at(best), achieved=achieved,
        pct=round((best.weight_kg or 0) / t.weight_kg * 100) if best else 0,
        est_1rm=stats.est_1rm(t.person_id, t.exercise_id),
        actual_1rm=single.weight_kg if single else None,
    )


@router.get("/targets", response_model=list[s.TargetOut])
def list_targets(db: Db = Depends(get_db)):
    """Unachieved first (closest first), then achieved."""
    stats = get_stats(db)
    people = dict(db.execute(select(m.Person.id, m.Person.name)).all())
    exercises = dict(db.execute(select(m.Exercise.id, m.Exercise.name)).all())
    out = [_target_out(t, stats, people, exercises) for t in db.scalars(select(m.Target))]
    return sorted(out, key=lambda t: (t.achieved, -t.pct if not t.achieved else 0,
                                      f"{t.person} {t.exercise}".lower()))


@router.put("/targets", response_model=s.TargetOut)
def set_target(body: s.TargetIn, db: Db = Depends(get_db)):
    """Creates or replaces the target for a person + exercise."""
    get_or_404(db, m.Person, body.person_id)
    ex = get_or_404(db, m.Exercise, body.exercise_id)
    if ex.kind == "cardio":
        raise HTTPException(422, "Targets are for strength exercises.")
    t = db.scalar(select(m.Target).where(m.Target.person_id == body.person_id,
                                         m.Target.exercise_id == body.exercise_id))
    if not t:
        t = m.Target(person_id=body.person_id, exercise_id=body.exercise_id)
        db.add(t)
    t.weight_kg, t.reps, t.set_at = body.weight_kg, body.reps, date.today()
    db.commit()
    people = dict(db.execute(select(m.Person.id, m.Person.name)).all())
    exercises = dict(db.execute(select(m.Exercise.id, m.Exercise.name)).all())
    return _target_out(t, get_stats(db), people, exercises)


@router.delete("/targets/{target_id}", status_code=204)
def delete_target(target_id: int, db: Db = Depends(get_db)):
    db.delete(get_or_404(db, m.Target, target_id))
    db.commit()
