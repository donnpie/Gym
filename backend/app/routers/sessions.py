"""Sessions and everything inside them. Every change returns the whole updated session."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session as Db

from .. import models as m
from .. import schemas as s
from ..db import get_db
from ..services import (
    SESSION_LOAD, get_or_404, get_or_create_exercise, get_or_create_person, last_equipment,
    load_session, session_out,
)

router = APIRouter(prefix="/api", tags=["sessions"])


def _done(db: Db, session_id: int) -> s.SessionOut:
    db.commit()
    db.expire_all()
    return session_out(load_session(db, session_id))


def _make_active(db: Db, sess: m.Session) -> None:
    """Only one session is active at a time; the others go back to history."""
    db.execute(update(m.Session).where(m.Session.id != sess.id, m.Session.status == "active")
               .values(status="finished"))
    sess.status = "active"


def _in_session(sess: m.Session, person_id: int, except_participant: int | None = None):
    return next((p for p in sess.participants
                 if p.person_id == person_id and p.id != except_participant), None)


# ---------- Sessions ----------

@router.get("/sessions", response_model=list[s.SessionOut])
def list_sessions(db: Db = Depends(get_db)):
    q = select(m.Session).options(*SESSION_LOAD).order_by(m.Session.date.desc(), m.Session.id.desc())
    return [session_out(x) for x in db.scalars(q)]


@router.get("/sessions/{session_id}", response_model=s.SessionOut)
def get_session(session_id: int, db: Db = Depends(get_db)):
    return session_out(load_session(db, session_id))


@router.post("/sessions", response_model=s.SessionOut, status_code=201)
def create_session(body: s.SessionIn, db: Db = Depends(get_db)):
    people = [get_or_create_person(db, n) for n in body.people]
    seen = set()
    for p in people:
        if p.id in seen:
            raise HTTPException(409, f"{p.name} is entered more than once. Each person can only be in a session once.")
        seen.add(p.id)
    sess = m.Session(date=body.date)
    db.add(sess)
    sess.participants = [m.Participant(person_id=p.id, position=i) for i, p in enumerate(people)]
    db.flush()
    _make_active(db, sess)
    return _done(db, sess.id)


@router.patch("/sessions/{session_id}", response_model=s.SessionOut)
def update_session(session_id: int, body: s.SessionPatch, db: Db = Depends(get_db)):
    sess = get_or_404(db, m.Session, session_id)
    if body.date is not None:
        sess.date = body.date
    if body.status == "active":
        _make_active(db, sess)
    elif body.status == "finished":
        sess.status = "finished"
    return _done(db, session_id)


@router.delete("/sessions/{session_id}", status_code=204)
def delete_session(session_id: int, db: Db = Depends(get_db)):
    db.delete(get_or_404(db, m.Session, session_id))
    db.commit()


# ---------- Participants ----------

@router.post("/sessions/{session_id}/participants", response_model=s.SessionOut, status_code=201)
def add_participant(session_id: int, body: s.ParticipantIn, db: Db = Depends(get_db)):
    sess = load_session(db, session_id)
    person = get_or_create_person(db, body.name)
    if _in_session(sess, person.id):
        raise HTTPException(409, f"{person.name} is already in this session.")
    pos = max((p.position for p in sess.participants), default=-1) + 1
    db.add(m.Participant(session_id=session_id, person_id=person.id, position=pos))
    return _done(db, session_id)


@router.patch("/participants/{participant_id}", response_model=s.SessionOut)
def reassign_participant(participant_id: int, body: s.ParticipantPatch, db: Db = Depends(get_db)):
    """Makes this column someone else (existing or new) without renaming anyone."""
    part = get_or_404(db, m.Participant, participant_id)
    person = get_or_create_person(db, body.name)
    sess = load_session(db, part.session_id)
    clash = _in_session(sess, person.id, except_participant=part.id)
    if clash:
        raise HTTPException(409, f"{person.name} is already in this session.")
    part.person_id = person.id
    return _done(db, part.session_id)


@router.delete("/participants/{participant_id}", response_model=s.SessionOut)
def remove_participant(participant_id: int, db: Db = Depends(get_db)):
    part = get_or_404(db, m.Participant, participant_id)
    session_id = part.session_id
    db.delete(part)
    return _done(db, session_id)


# ---------- Entries (an exercise within a participant's workout) ----------

@router.post("/participants/{participant_id}/entries", response_model=s.SessionOut, status_code=201)
def add_entry(participant_id: int, body: s.EntryIn, db: Db = Depends(get_db)):
    part = get_or_404(db, m.Participant, participant_id)
    if body.exercise_id is not None:
        ex = get_or_404(db, m.Exercise, body.exercise_id)
    elif body.name:
        ex = get_or_create_exercise(db, body.name)
    else:
        raise HTTPException(422, "Give an exercise_id or a name.")
    equipment, bar_id, db_count = last_equipment(db, ex, part.person_id)
    pos = (db.scalar(select(func.max(m.Entry.position)).where(m.Entry.participant_id == part.id)) or 0) + 1
    db.add(m.Entry(participant_id=part.id, exercise_id=ex.id, position=pos,
                   equipment_type=equipment, bar_id=bar_id, dumbbell_count=db_count))
    return _done(db, part.session_id)


@router.patch("/entries/{entry_id}", response_model=s.SessionOut)
def update_entry(entry_id: int, body: s.EntryPatch, db: Db = Depends(get_db)):
    entry = get_or_404(db, m.Entry, entry_id)
    fields = body.model_fields_set
    if body.exercise_id is not None:
        ex = get_or_404(db, m.Exercise, body.exercise_id)
        if ex.kind != entry.exercise.kind:
            raise HTTPException(409, "Can't switch between cardio and strength exercises.")
        entry.exercise_id = ex.id
    if body.equipment_type is not None:
        if (body.equipment_type == "cardio") != (entry.exercise.kind == "cardio"):
            raise HTTPException(422, "Only cardio exercises use cardio equipment.")
        entry.equipment_type = body.equipment_type
        entry.exercise.equipment_type = body.equipment_type  # remembered for next time
    if "bar_id" in fields:
        if body.bar_id is not None:
            get_or_404(db, m.Bar, body.bar_id)
        entry.bar_id = body.bar_id
    if body.dumbbell_count is not None:
        entry.dumbbell_count = body.dumbbell_count
    if body.notes is not None:
        entry.notes = body.notes
    return _done(db, entry.participant.session_id)


@router.delete("/entries/{entry_id}", response_model=s.SessionOut)
def delete_entry(entry_id: int, db: Db = Depends(get_db)):
    entry = get_or_404(db, m.Entry, entry_id)
    session_id = entry.participant.session_id
    db.delete(entry)
    return _done(db, session_id)


# ---------- Sets ----------

def _apply_set(db: Db, entry: m.Entry, ws: m.WorkSet, body: s.SetIn) -> None:
    if entry.equipment_type == "cardio":
        if not body.duration_sec or not body.distance_km:
            raise HTTPException(422, "Enter a duration and a distance.")
        ws.duration_sec, ws.distance_km = body.duration_sec, body.distance_km
        ws.reps = ws.weight_kg = ws.rir = None
        ws.bands = []
        return
    if not body.reps:
        raise HTTPException(422, "Enter reps.")
    band_ids = body.band_ids if entry.equipment_type == "band" else []
    for bid in band_ids:
        get_or_404(db, m.Band, bid)
    weight = body.weight_kg
    if entry.equipment_type in ("band", "bodyweight") and weight is None:
        weight = 0
    if entry.equipment_type == "band":
        weight = 0  # bands have no numeric weight
    if weight is None:
        raise HTTPException(422, "Enter reps and weight.")
    ws.reps, ws.weight_kg, ws.rir = body.reps, weight, body.rir
    ws.duration_sec = ws.distance_km = None
    ws.bands = [m.SetBand(position=i, band_id=b) for i, b in enumerate(band_ids)]


@router.post("/entries/{entry_id}/sets", response_model=s.SessionOut, status_code=201)
def add_set(entry_id: int, body: s.SetIn, db: Db = Depends(get_db)):
    entry = get_or_404(db, m.Entry, entry_id)
    pos = (db.scalar(select(func.max(m.WorkSet.position)).where(m.WorkSet.entry_id == entry_id)) or 0) + 1
    ws = m.WorkSet(entry_id=entry_id, position=pos)
    _apply_set(db, entry, ws, body)
    db.add(ws)
    return _done(db, entry.participant.session_id)


@router.put("/sets/{set_id}", response_model=s.SessionOut)
def replace_set(set_id: int, body: s.SetIn, db: Db = Depends(get_db)):
    ws = get_or_404(db, m.WorkSet, set_id)
    ws.bands.clear()
    db.flush()  # free the (set_id, position) keys before re-adding bands
    _apply_set(db, ws.entry, ws, body)
    return _done(db, ws.entry.participant.session_id)


@router.delete("/sets/{set_id}", response_model=s.SessionOut)
def delete_set(set_id: int, db: Db = Depends(get_db)):
    ws = get_or_404(db, m.WorkSet, set_id)
    session_id = ws.entry.participant.session_id
    db.delete(ws)
    return _done(db, session_id)
