"""Shared lookups and serialisation used by several routers."""
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session as Db, selectinload

from . import models as m
from . import schemas as s


def clean_name(name: str) -> str:
    name = " ".join((name or "").split())
    if not name:
        raise HTTPException(422, "Name can't be blank.")
    return name


def get_or_create_person(db: Db, name: str) -> m.Person:
    name = clean_name(name)
    person = db.scalar(select(m.Person).where(m.Person.name == name))  # NOCASE column
    if not person:
        person = m.Person(name=name)
        db.add(person)
        db.flush()
    return person


def get_or_create_exercise(db: Db, name: str, kind: str = "strength") -> m.Exercise:
    name = clean_name(name)
    ex = db.scalar(select(m.Exercise).where(m.Exercise.name == name))
    if not ex:
        ex = m.Exercise(name=name, kind=kind, equipment_type="cardio" if kind == "cardio" else "weight")
        db.add(ex)
        db.flush()
    return ex


def get_or_404(db: Db, model, id_: int):
    obj = db.get(model, id_)
    if obj is None:
        raise HTTPException(404, f"{model.__name__} {id_} not found.")
    return obj


def load_session(db: Db, session_id: int) -> m.Session:
    sess = db.scalar(
        select(m.Session).where(m.Session.id == session_id).options(*SESSION_LOAD)
    )
    if sess is None:
        raise HTTPException(404, f"Session {session_id} not found.")
    return sess


SESSION_LOAD = (
    selectinload(m.Session.participants).selectinload(m.Participant.person),
    selectinload(m.Session.participants).selectinload(m.Participant.entries)
    .selectinload(m.Entry.exercise),
    selectinload(m.Session.participants).selectinload(m.Participant.entries)
    .selectinload(m.Entry.sets).selectinload(m.WorkSet.bands),
)


def session_out(sess: m.Session) -> s.SessionOut:
    return s.SessionOut(
        id=sess.id,
        date=sess.date,
        status=sess.status,
        participants=[
            s.ParticipantOut(
                id=p.id,
                person_id=p.person_id,
                name=p.person.name,
                entries=[
                    s.EntryOut(
                        id=e.id,
                        exercise_id=e.exercise_id,
                        name=e.exercise.name,
                        kind=e.exercise.kind,
                        equipment_type=e.equipment_type,
                        bar_id=e.bar_id,
                        dumbbell_count=e.dumbbell_count,
                        notes=e.notes or "",
                        sets=[
                            s.SetOut(
                                id=w.id, reps=w.reps, weight_kg=w.weight_kg, rir=w.rir,
                                duration_sec=w.duration_sec, distance_km=w.distance_km,
                                band_ids=[b.band_id for b in w.bands],
                            )
                            for w in e.sets
                        ],
                    )
                    for e in p.entries
                ],
            )
            for p in sess.participants
        ],
    )


def last_equipment(db: Db, exercise: m.Exercise, person_id: int) -> tuple[str, int | None, int]:
    """Equipment for a new entry: this person's most recent use of the exercise,
    else anyone's, else the exercise's own default."""
    if exercise.kind == "cardio":
        return "cardio", None, 2
    base = (
        select(m.Entry)
        .join(m.Participant).join(m.Session)
        .where(m.Entry.exercise_id == exercise.id)
        .order_by(m.Session.date.desc(), m.Entry.id.desc())
        .limit(1)
    )
    prev = db.scalar(base.where(m.Participant.person_id == person_id)) or db.scalar(base)
    if prev:
        return prev.equipment_type, prev.bar_id, prev.dumbbell_count
    return exercise.equipment_type or "weight", None, 2
