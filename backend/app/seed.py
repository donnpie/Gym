"""Starting data for a fresh database: the equipment inventory and cardio activities."""
from sqlalchemy import select
from sqlalchemy.orm import Session as Db

from .models import Accessory, Band, Bar, Exercise, LooseWeight

# Power and mini bands share these colours/strengths, lightest to heaviest.
LOOP_BAND_STRENGTHS = [
    ("yellow", "Extra small"),
    ("red", "Small"),
    ("black", "Large 1"),
    ("purple", "Large 2"),
    ("green", "Extra large"),
]

DEFAULT_BARS = [("Men's bar", 20), ("Women's bar", 15), ("EZ bar", 9.5)]
DEFAULT_PLATES = [(20, 4), (15, 2), (10, 2), (5, 2), (2.5, 4), (1.25, 4), (0.25, 4)]
DEFAULT_DUMBBELLS = [(kg, 2) for kg in (2, 4, 5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25, 27.5, 30)]
DEFAULT_KETTLEBELLS = [(kg, 1) for kg in (4, 6, 8, 10, 12, 16, 20)]
DEFAULT_ACCESSORIES = ["Landmine attachment"]
DEFAULT_BANDS = (
    [("Power band", c, s) for c, s in LOOP_BAND_STRENGTHS]
    + [("Mini band", c, s) for c, s in LOOP_BAND_STRENGTHS]
    + [("Flat band", "blue", "Light"), ("Flat band", "purple", "Heavy")]
)
# Add a name here to offer another cardio activity (e.g. "Cycle", "Swim").
DEFAULT_CARDIO = ["Run", "Walk"]


def seed_inventory(db: Db) -> None:
    db.add_all(Bar(name=n, kg=kg, position=i) for i, (n, kg) in enumerate(DEFAULT_BARS))
    for kind, rows in (("plate", DEFAULT_PLATES), ("dumbbell", DEFAULT_DUMBBELLS),
                       ("kettlebell", DEFAULT_KETTLEBELLS)):
        db.add_all(LooseWeight(kind=kind, kg=kg, count=c) for kg, c in rows)
    db.add_all(Accessory(name=n, count=1, position=i) for i, n in enumerate(DEFAULT_ACCESSORIES))
    db.add_all(Band(type=t, colour=c, strength=s, count=1, position=i)
               for i, (t, c, s) in enumerate(DEFAULT_BANDS))


def seed_cardio(db: Db) -> None:
    for name in DEFAULT_CARDIO:
        if not db.scalar(select(Exercise).where(Exercise.name == name)):
            db.add(Exercise(name=name, kind="cardio", equipment_type="cardio"))


def seed_if_empty(db: Db) -> None:
    if db.scalar(select(Bar.id).limit(1)) is None and db.scalar(select(LooseWeight.id).limit(1)) is None:
        seed_inventory(db)
    seed_cardio(db)
    db.commit()
