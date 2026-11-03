"""Personal records, best-at-N-reps, estimated 1RM and target progress.

Everything is computed from all logged sets. A home gym's history is small,
so loading it in one query and working in Python keeps this simple.
"""
from collections import defaultdict
from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session as Db

from . import models as m

EPS = 1e-9
EST_REPS = range(2, 7)  # estimated 1RM averages the best sets at 2–6 reps
MAX_TABLE_REPS = 16


@dataclass
class SetRow:
    date: date
    person_id: int
    exercise_id: int
    cardio: bool
    reps: int | None
    weight_kg: float | None
    rir: int | None
    distance_km: float | None


def load_rows(db: Db) -> list[SetRow]:
    q = (
        select(m.Session.date, m.Participant.person_id, m.Entry.exercise_id, m.Entry.equipment_type,
               m.WorkSet.reps, m.WorkSet.weight_kg, m.WorkSet.rir, m.WorkSet.distance_km)
        .join(m.Participant, m.Participant.session_id == m.Session.id)
        .join(m.Entry, m.Entry.participant_id == m.Participant.id)
        .join(m.WorkSet, m.WorkSet.entry_id == m.Entry.id)
    )
    return [
        SetRow(d, pid, eid, eq == "cardio", reps, w, rir, km)
        for d, pid, eid, eq, reps, w, rir, km in db.execute(q)
    ]


class Stats:
    def __init__(self, rows: list[SetRow]):
        self.by_pair: dict[tuple[int, int], list[SetRow]] = defaultdict(list)
        for r in rows:
            self.by_pair[(r.person_id, r.exercise_id)].append(r)

    def strength(self, person_id: int, exercise_id: int) -> list[SetRow]:
        return [r for r in self.by_pair.get((person_id, exercise_id), []) if not r.cardio]

    def pr(self, person_id: int, exercise_id: int) -> SetRow | None:
        """Heaviest set; None for weightless exercises (bands, bodyweight)."""
        best = None
        for r in self.strength(person_id, exercise_id):
            if (r.weight_kg or 0) > 0 and (best is None or r.weight_kg > best.weight_kg):
                best = r
        return best

    def best_at_reps(self, person_id: int, exercise_id: int, reps: int) -> SetRow | None:
        """Heaviest set done for at least `reps` reps."""
        best = None
        for r in self.strength(person_id, exercise_id):
            if (r.reps or 0) < reps:
                continue
            if best is None or (r.weight_kg or 0) > (best.weight_kg or 0):
                best = r
        return best

    def est_1rm(self, person_id: int, exercise_id: int) -> float | None:
        """Epley, averaged over the best sets at 2–6 reps."""
        ests = []
        for reps in EST_REPS:
            b = self.best_at_reps(person_id, exercise_id, reps)
            if b:
                ests.append((b.weight_kg or 0) * (1 + reps / 30))
        return sum(ests) / len(ests) if ests else None

    def longest(self, person_id: int, exercise_id: int) -> float | None:
        km = max((r.distance_km or 0 for r in self.by_pair.get((person_id, exercise_id), []) if r.cardio),
                 default=0)
        return km or None

    def pairs(self):
        return self.by_pair.keys()


def get_stats(db: Db) -> Stats:
    return Stats(load_rows(db))
