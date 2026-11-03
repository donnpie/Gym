"""Database tables.

People and exercises are first-class: sessions refer to them by id, so a
rename happens in one place. A person can appear in a session only once
(unique session_id + person_id).
"""
from datetime import date, datetime

from sqlalchemy import (
    Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base

# Equipment an exercise entry can use. "cardio" is for cardio exercises only.
EQUIPMENT_TYPES = ("weight", "barbell", "dumbbell", "band", "bodyweight", "cardio")


class Person(Base):
    __tablename__ = "people"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100, collation="NOCASE"), unique=True)


class Exercise(Base):
    __tablename__ = "exercises"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100, collation="NOCASE"), unique=True)
    kind: Mapped[str] = mapped_column(String(20), default="strength")  # strength | cardio
    # Equipment last used; new entries start from it.
    equipment_type: Mapped[str] = mapped_column(String(20), default="weight")


class Session(Base):
    __tablename__ = "sessions"
    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | finished
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    # Id from the old browser app, so re-importing the same export updates rather than duplicates.
    legacy_id: Mapped[str | None] = mapped_column(String(50), unique=True)

    participants: Mapped[list["Participant"]] = relationship(
        back_populates="session", cascade="all, delete-orphan", order_by="Participant.position")


class Participant(Base):
    __tablename__ = "participants"
    __table_args__ = (UniqueConstraint("session_id", "person_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"))
    person_id: Mapped[int] = mapped_column(ForeignKey("people.id"))
    position: Mapped[int] = mapped_column(Integer, default=0)

    session: Mapped[Session] = relationship(back_populates="participants")
    person: Mapped[Person] = relationship()
    entries: Mapped[list["Entry"]] = relationship(
        back_populates="participant", cascade="all, delete-orphan", order_by="Entry.position")


class Entry(Base):
    """One exercise done by one participant in one session."""
    __tablename__ = "entries"
    id: Mapped[int] = mapped_column(primary_key=True)
    participant_id: Mapped[int] = mapped_column(ForeignKey("participants.id", ondelete="CASCADE"))
    exercise_id: Mapped[int] = mapped_column(ForeignKey("exercises.id"))
    position: Mapped[int] = mapped_column(Integer, default=0)
    equipment_type: Mapped[str] = mapped_column(String(20), default="weight")
    bar_id: Mapped[int | None] = mapped_column(ForeignKey("bars.id", ondelete="SET NULL"))
    dumbbell_count: Mapped[int] = mapped_column(Integer, default=2)
    notes: Mapped[str] = mapped_column(Text, default="")

    participant: Mapped[Participant] = relationship(back_populates="entries")
    exercise: Mapped[Exercise] = relationship()
    sets: Mapped[list["WorkSet"]] = relationship(
        back_populates="entry", cascade="all, delete-orphan", order_by="WorkSet.position")


class WorkSet(Base):
    """A strength set (reps, weight, rir) or a cardio bout (duration, distance)."""
    __tablename__ = "sets"
    id: Mapped[int] = mapped_column(primary_key=True)
    entry_id: Mapped[int] = mapped_column(ForeignKey("entries.id", ondelete="CASCADE"))
    position: Mapped[int] = mapped_column(Integer, default=0)
    reps: Mapped[int | None] = mapped_column(Integer)
    weight_kg: Mapped[float | None] = mapped_column(Float)
    rir: Mapped[int | None] = mapped_column(Integer)
    duration_sec: Mapped[int | None] = mapped_column(Integer)
    distance_km: Mapped[float | None] = mapped_column(Float)

    entry: Mapped[Entry] = relationship(back_populates="sets")
    bands: Mapped[list["SetBand"]] = relationship(
        cascade="all, delete-orphan", order_by="SetBand.position")


class SetBand(Base):
    """Band(s) used for a set — one, or two combined."""
    __tablename__ = "set_bands"
    set_id: Mapped[int] = mapped_column(ForeignKey("sets.id", ondelete="CASCADE"), primary_key=True)
    position: Mapped[int] = mapped_column(Integer, primary_key=True)
    band_id: Mapped[int] = mapped_column(ForeignKey("bands.id"))


class Target(Base):
    __tablename__ = "targets"
    __table_args__ = (UniqueConstraint("person_id", "exercise_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    person_id: Mapped[int] = mapped_column(ForeignKey("people.id", ondelete="CASCADE"))
    exercise_id: Mapped[int] = mapped_column(ForeignKey("exercises.id", ondelete="CASCADE"))
    weight_kg: Mapped[float] = mapped_column(Float)
    reps: Mapped[int] = mapped_column(Integer)
    set_at: Mapped[date] = mapped_column(Date, default=date.today)


# ---------- Equipment inventory ----------
# Bars and bands are referenced by sets/entries, so removing one archives it
# instead of deleting it; history keeps pointing at it.

class Bar(Base):
    __tablename__ = "bars"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), default="")
    kg: Mapped[float] = mapped_column(Float, default=0)
    position: Mapped[int] = mapped_column(Integer, default=0)  # first is the default bar
    archived: Mapped[bool] = mapped_column(Boolean, default=False)


class LooseWeight(Base):
    """Plates, dumbbells and kettlebells: a weight and how many you own."""
    __tablename__ = "loose_weights"
    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(20))  # plate | dumbbell | kettlebell
    kg: Mapped[float] = mapped_column(Float, default=0)
    count: Mapped[int] = mapped_column(Integer, default=0)


class Accessory(Base):
    __tablename__ = "accessories"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), default="")
    count: Mapped[int] = mapped_column(Integer, default=1)
    position: Mapped[int] = mapped_column(Integer, default=0)


class Band(Base):
    __tablename__ = "bands"
    id: Mapped[int] = mapped_column(primary_key=True)
    type: Mapped[str] = mapped_column(String(50), default="")
    colour: Mapped[str] = mapped_column(String(50), default="")
    strength: Mapped[str] = mapped_column(String(50), default="")
    count: Mapped[int] = mapped_column(Integer, default=1)
    position: Mapped[int] = mapped_column(Integer, default=0)  # lightest to heaviest within a type
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
