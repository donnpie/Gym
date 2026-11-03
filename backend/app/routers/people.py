from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session as Db

from .. import models as m
from .. import schemas as s
from ..db import get_db
from ..services import clean_name, get_or_404

router = APIRouter(prefix="/api/people", tags=["people"])


@router.get("", response_model=list[s.PersonOut])
def list_people(db: Db = Depends(get_db)):
    return db.scalars(select(m.Person).order_by(m.Person.name)).all()


@router.post("", response_model=s.PersonOut, status_code=201)
def create_person(body: s.PersonIn, db: Db = Depends(get_db)):
    name = clean_name(body.name)
    if db.scalar(select(m.Person).where(m.Person.name == name)):
        raise HTTPException(409, f"{name} already exists.")
    person = m.Person(name=name)
    db.add(person)
    db.commit()
    return person


@router.patch("/{person_id}", response_model=s.PersonOut)
def rename_person(person_id: int, body: s.PersonIn, db: Db = Depends(get_db)):
    """Renames the person everywhere. Use merge to fold two spellings together."""
    person = get_or_404(db, m.Person, person_id)
    name = clean_name(body.name)
    clash = db.scalar(select(m.Person).where(m.Person.name == name, m.Person.id != person_id))
    if clash:
        raise HTTPException(409, f"{clash.name} already exists. Merge them instead.")
    person.name = name
    db.commit()
    return person


@router.post("/{person_id}/merge", response_model=s.PersonOut)
def merge_person(person_id: int, body: s.MergeIn, db: Db = Depends(get_db)):
    """Moves all of this person's sessions and targets onto `into_id`, then deletes them."""
    src = get_or_404(db, m.Person, person_id)
    dst = get_or_404(db, m.Person, body.into_id)
    if src.id == dst.id:
        raise HTTPException(422, "Can't merge a person into themselves.")
    dst_sessions = set(db.scalars(select(m.Participant.session_id).where(m.Participant.person_id == dst.id)))
    parts = db.scalars(select(m.Participant).where(m.Participant.person_id == src.id)).all()
    shared = [p for p in parts if p.session_id in dst_sessions]
    if shared:
        dates = ", ".join(sorted(str(p.session.date) for p in shared))
        raise HTTPException(409, f"{src.name} and {dst.name} are both in the session(s) on {dates}. "
                                 "Rename one of those columns first.")
    for p in parts:
        p.person_id = dst.id
    dst_targets = set(db.scalars(select(m.Target.exercise_id).where(m.Target.person_id == dst.id)))
    for t in db.scalars(select(m.Target).where(m.Target.person_id == src.id)).all():
        if t.exercise_id in dst_targets:
            db.delete(t)  # keep the target already set for the person merged into
        else:
            t.person_id = dst.id
    db.flush()
    db.delete(src)
    db.commit()
    return dst


@router.delete("/{person_id}", status_code=204)
def delete_person(person_id: int, db: Db = Depends(get_db)):
    person = get_or_404(db, m.Person, person_id)
    if db.scalar(select(m.Participant.id).where(m.Participant.person_id == person_id).limit(1)):
        raise HTTPException(409, f"{person.name} has logged sessions. Merge them into someone instead.")
    db.delete(person)
    db.commit()
