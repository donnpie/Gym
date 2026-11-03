from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session as Db

from .. import models as m
from .. import schemas as s
from ..db import get_db
from ..services import clean_name, get_or_404
from ..stats import get_stats

router = APIRouter(prefix="/api/exercises", tags=["exercises"])


@router.get("", response_model=list[s.ExerciseOut])
def list_exercises(db: Db = Depends(get_db)):
    return db.scalars(select(m.Exercise).order_by(m.Exercise.name)).all()


@router.get("/summary", response_model=list[s.ExerciseSummary])
def exercise_summary(db: Db = Depends(get_db)):
    """Every exercise with how often and when it was last done, and each person's best."""
    usage = {
        eid: (times, last)
        for eid, times, last in db.execute(
            select(m.Entry.exercise_id, func.count(m.Entry.id), func.max(m.Session.date))
            .join(m.Participant, m.Entry.participant_id == m.Participant.id)
            .join(m.Session, m.Participant.session_id == m.Session.id)
            .group_by(m.Entry.exercise_id)
        )
    }
    people_by_ex: dict[int, set[int]] = {}
    for eid, pid in db.execute(
        select(m.Entry.exercise_id, m.Participant.person_id)
        .join(m.Participant, m.Entry.participant_id == m.Participant.id).distinct()
    ):
        people_by_ex.setdefault(eid, set()).add(pid)
    names = dict(db.execute(select(m.Person.id, m.Person.name)).all())
    stats = get_stats(db)

    out = []
    for ex in db.scalars(select(m.Exercise).order_by(m.Exercise.name)):
        times, last = usage.get(ex.id, (0, None))
        bests = []
        for pid in sorted(people_by_ex.get(ex.id, ()), key=lambda p: names[p].lower()):
            if ex.kind == "cardio":
                bests.append(s.PersonBest(person_id=pid, person=names[pid], distance_km=stats.longest(pid, ex.id)))
            else:
                pr = stats.pr(pid, ex.id)
                bests.append(s.PersonBest(person_id=pid, person=names[pid], weight_kg=pr.weight_kg if pr else None))
        out.append(s.ExerciseSummary(
            id=ex.id, name=ex.name, kind=ex.kind, equipment_type=ex.equipment_type,
            times=times, last_date=last, bests=bests,
        ))
    return out


@router.post("", response_model=s.ExerciseOut, status_code=201)
def create_exercise(body: s.ExerciseIn, db: Db = Depends(get_db)):
    name = clean_name(body.name)
    if db.scalar(select(m.Exercise).where(m.Exercise.name == name)):
        raise HTTPException(409, f"{name} already exists.")
    ex = m.Exercise(name=name, kind=body.kind, equipment_type="cardio" if body.kind == "cardio" else "weight")
    db.add(ex)
    db.commit()
    return ex


@router.patch("/{exercise_id}", response_model=s.ExerciseOut)
def update_exercise(exercise_id: int, body: s.ExercisePatch, db: Db = Depends(get_db)):
    ex = get_or_404(db, m.Exercise, exercise_id)
    if body.name is not None:
        name = clean_name(body.name)
        clash = db.scalar(select(m.Exercise).where(m.Exercise.name == name, m.Exercise.id != exercise_id))
        if clash:
            raise HTTPException(409, f"{clash.name} already exists. Merge them instead.")
        ex.name = name
    if body.kind is not None and body.kind != ex.kind:
        if db.scalar(select(m.Entry.id).where(m.Entry.exercise_id == exercise_id).limit(1)):
            raise HTTPException(409, "Can't switch between cardio and strength once it has been logged.")
        ex.kind = body.kind
        ex.equipment_type = "cardio" if body.kind == "cardio" else "weight"
    db.commit()
    return ex


@router.post("/{exercise_id}/merge", response_model=s.ExerciseOut)
def merge_exercise(exercise_id: int, body: s.MergeIn, db: Db = Depends(get_db)):
    """Folds this exercise into `into_id` (e.g. two spellings of the same lift)."""
    src = get_or_404(db, m.Exercise, exercise_id)
    dst = get_or_404(db, m.Exercise, body.into_id)
    if src.id == dst.id:
        raise HTTPException(422, "Can't merge an exercise into itself.")
    if src.kind != dst.kind:
        raise HTTPException(409, "Can't merge a cardio exercise with a strength one.")
    for e in db.scalars(select(m.Entry).where(m.Entry.exercise_id == src.id)).all():
        e.exercise_id = dst.id
    dst_targets = set(db.scalars(select(m.Target.person_id).where(m.Target.exercise_id == dst.id)))
    for t in db.scalars(select(m.Target).where(m.Target.exercise_id == src.id)).all():
        if t.person_id in dst_targets:
            db.delete(t)
        else:
            t.exercise_id = dst.id
    db.flush()
    db.delete(src)
    db.commit()
    return dst


@router.delete("/{exercise_id}", status_code=204)
def delete_exercise(exercise_id: int, db: Db = Depends(get_db)):
    ex = get_or_404(db, m.Exercise, exercise_id)
    if db.scalar(select(m.Entry.id).where(m.Entry.exercise_id == exercise_id).limit(1)):
        raise HTTPException(409, f"{ex.name} has been logged. Merge it into another exercise instead.")
    db.delete(ex)
    db.commit()
