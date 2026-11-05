import datetime as dt
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Equipment = Literal["weight", "barbell", "plates", "dumbbell", "band", "bodyweight", "cardio"]


class Orm(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- People & exercises ----------

class PersonIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class PersonOut(Orm):
    id: int
    name: str


class ExerciseIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    kind: Literal["strength", "cardio"] = "strength"


class ExercisePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    kind: Literal["strength", "cardio"] | None = None


class ExerciseOut(Orm):
    id: int
    name: str
    kind: str
    equipment_type: str


class MergeIn(BaseModel):
    into_id: int


class PersonBest(BaseModel):
    person_id: int
    person: str
    weight_kg: float | None = None
    distance_km: float | None = None


class ExerciseSummary(ExerciseOut):
    times: int
    last_date: dt.date | None
    bests: list[PersonBest]


# ---------- Sessions ----------

class SetOut(Orm):
    id: int
    reps: int | None
    weight_kg: float | None
    rir: int | None
    duration_sec: int | None
    distance_km: float | None
    band_ids: list[int]


class EntryOut(Orm):
    id: int
    exercise_id: int
    name: str
    kind: str
    equipment_type: str
    bar_id: int | None
    dumbbell_count: int
    notes: str
    sets: list[SetOut]


class ParticipantOut(Orm):
    id: int
    person_id: int
    name: str
    entries: list[EntryOut]


class SessionOut(Orm):
    id: int
    date: dt.date
    status: str
    participants: list[ParticipantOut]


class SessionIn(BaseModel):
    date: dt.date
    people: list[str] = Field(min_length=1)


class SessionPatch(BaseModel):
    date: dt.date | None = None
    status: Literal["active", "finished"] | None = None


class ParticipantIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class ParticipantPatch(BaseModel):
    # Points this column at a different person (or a new one) without renaming anyone else.
    name: str = Field(min_length=1, max_length=100)


class EntryIn(BaseModel):
    exercise_id: int | None = None
    name: str | None = None  # creates the exercise if it doesn't exist


class EntryPatch(BaseModel):
    exercise_id: int | None = None
    equipment_type: Equipment | None = None
    bar_id: int | None = None
    dumbbell_count: Literal[1, 2] | None = None
    notes: str | None = None


class SetMoveIn(BaseModel):
    direction: Literal["up", "down"]


class SetIn(BaseModel):
    reps: int | None = Field(default=None, ge=1)
    weight_kg: float | None = Field(default=None, ge=0)
    rir: int | None = Field(default=None, ge=0, le=10)
    duration_sec: int | None = Field(default=None, gt=0)
    distance_km: float | None = Field(default=None, gt=0)
    band_ids: list[int] = Field(default_factory=list, max_length=2)


# ---------- Targets & stats ----------

class TargetIn(BaseModel):
    person_id: int
    exercise_id: int
    weight_kg: float = Field(gt=0)
    reps: int = Field(ge=1)


class BestAt(BaseModel):
    weight_kg: float
    date: dt.date
    rir: int | None


class TargetOut(BaseModel):
    id: int
    person_id: int
    person: str
    exercise_id: int
    exercise: str
    weight_kg: float
    reps: int
    set_at: dt.date
    best: BestAt | None
    achieved: bool
    pct: int
    est_1rm: float | None
    actual_1rm: float | None


class PROut(BaseModel):
    person_id: int
    person: str
    exercise_id: int
    exercise: str
    weight_kg: float
    reps: int | None


class BestRow(BaseModel):
    reps: int
    best: BestAt | None


class BestTable(BaseModel):
    rows: list[BestRow]
    est_1rm: float | None


# ---------- Inventory ----------

class BarIO(Orm):
    id: int | None = None
    name: str = ""
    kg: float = 0


class LooseWeightIO(Orm):
    id: int | None = None
    kg: float = 0
    count: int = 0


class AccessoryIO(Orm):
    id: int | None = None
    name: str = ""
    count: int = 1


class BandIO(Orm):
    id: int | None = None
    type: str = ""
    colour: str = ""
    strength: str = ""
    count: int = 1


class InventoryOut(BaseModel):
    bars: list[BarIO]
    plates: list[LooseWeightIO]
    dumbbells: list[LooseWeightIO]
    kettlebells: list[LooseWeightIO]
    accessories: list[AccessoryIO]
    bands: list[BandIO]
    # Archived bands still name the bands on old sets.
    archived_bands: list[BandIO]


class ImportResult(BaseModel):
    sessions: int
    warnings: list[str]
