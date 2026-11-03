"""Equipment inventory: bars, plates, dumbbells, kettlebells, accessories, bands."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session as Db

from .. import models as m
from .. import schemas as s
from ..db import get_db
from ..services import get_or_404

router = APIRouter(prefix="/api/inventory", tags=["inventory"])

LOOSE_KINDS = {"plates": "plate", "dumbbells": "dumbbell", "kettlebells": "kettlebell"}


def inventory_out(db: Db) -> s.InventoryOut:
    loose = lambda kind, desc=False: db.scalars(  # noqa: E731
        select(m.LooseWeight).where(m.LooseWeight.kind == kind)
        .order_by(m.LooseWeight.kg.desc() if desc else m.LooseWeight.kg, m.LooseWeight.id)).all()
    bands = db.scalars(select(m.Band).order_by(m.Band.position, m.Band.id)).all()
    return s.InventoryOut(
        bars=db.scalars(select(m.Bar).where(m.Bar.archived.is_(False)).order_by(m.Bar.position, m.Bar.id)).all(),
        plates=loose("plate", desc=True),
        dumbbells=loose("dumbbell"),
        kettlebells=loose("kettlebell"),
        accessories=db.scalars(select(m.Accessory).order_by(m.Accessory.position, m.Accessory.id)).all(),
        bands=[b for b in bands if not b.archived],
        archived_bands=[b for b in bands if b.archived],
    )


@router.get("", response_model=s.InventoryOut)
def get_inventory(db: Db = Depends(get_db)):
    return inventory_out(db)


def _next_pos(db: Db, model) -> int:
    return (db.scalar(select(func.max(model.position))) or 0) + 1


# Each list has create / update / delete. Updates take the full row.

@router.post("/bars", response_model=s.InventoryOut, status_code=201)
def add_bar(body: s.BarIO, db: Db = Depends(get_db)):
    db.add(m.Bar(name=body.name, kg=body.kg, position=_next_pos(db, m.Bar)))
    db.commit()
    return inventory_out(db)


@router.put("/bars/{item_id}", response_model=s.InventoryOut)
def update_bar(item_id: int, body: s.BarIO, db: Db = Depends(get_db)):
    bar = get_or_404(db, m.Bar, item_id)
    bar.name, bar.kg = body.name, body.kg
    db.commit()
    return inventory_out(db)


@router.delete("/bars/{item_id}", response_model=s.InventoryOut)
def remove_bar(item_id: int, db: Db = Depends(get_db)):
    get_or_404(db, m.Bar, item_id).archived = True
    db.commit()
    return inventory_out(db)


@router.post("/accessories", response_model=s.InventoryOut, status_code=201)
def add_accessory(body: s.AccessoryIO, db: Db = Depends(get_db)):
    db.add(m.Accessory(name=body.name, count=body.count, position=_next_pos(db, m.Accessory)))
    db.commit()
    return inventory_out(db)


@router.put("/accessories/{item_id}", response_model=s.InventoryOut)
def update_accessory(item_id: int, body: s.AccessoryIO, db: Db = Depends(get_db)):
    acc = get_or_404(db, m.Accessory, item_id)
    acc.name, acc.count = body.name, body.count
    db.commit()
    return inventory_out(db)


@router.delete("/accessories/{item_id}", response_model=s.InventoryOut)
def remove_accessory(item_id: int, db: Db = Depends(get_db)):
    db.delete(get_or_404(db, m.Accessory, item_id))
    db.commit()
    return inventory_out(db)


@router.post("/bands", response_model=s.InventoryOut, status_code=201)
def add_band(body: s.BandIO, db: Db = Depends(get_db)):
    db.add(m.Band(type=body.type, colour=body.colour, strength=body.strength, count=body.count,
                  position=_next_pos(db, m.Band)))
    db.commit()
    return inventory_out(db)


@router.put("/bands/{item_id}", response_model=s.InventoryOut)
def update_band(item_id: int, body: s.BandIO, db: Db = Depends(get_db)):
    band = get_or_404(db, m.Band, item_id)
    band.type, band.colour, band.strength, band.count = body.type, body.colour, body.strength, body.count
    db.commit()
    return inventory_out(db)


@router.delete("/bands/{item_id}", response_model=s.InventoryOut)
def remove_band(item_id: int, db: Db = Depends(get_db)):
    band = get_or_404(db, m.Band, item_id)
    used = db.scalar(select(m.SetBand.set_id).where(m.SetBand.band_id == item_id).limit(1))
    if used:
        band.archived = True  # old sets still name it
    else:
        db.delete(band)
    db.commit()
    return inventory_out(db)


def _loose_kind(list_name: str) -> str:
    kind = LOOSE_KINDS.get(list_name)
    if not kind:
        raise HTTPException(404, f"Unknown inventory list {list_name}.")
    return kind


@router.post("/{list_name}", response_model=s.InventoryOut, status_code=201)
def add_loose(list_name: str, body: s.LooseWeightIO, db: Db = Depends(get_db)):
    db.add(m.LooseWeight(kind=_loose_kind(list_name), kg=body.kg, count=body.count))
    db.commit()
    return inventory_out(db)


@router.put("/{list_name}/{item_id}", response_model=s.InventoryOut)
def update_loose(list_name: str, item_id: int, body: s.LooseWeightIO, db: Db = Depends(get_db)):
    item = get_or_404(db, m.LooseWeight, item_id)
    if item.kind != _loose_kind(list_name):
        raise HTTPException(404, "Not in that list.")
    item.kg, item.count = body.kg, body.count
    db.commit()
    return inventory_out(db)


@router.delete("/{list_name}/{item_id}", response_model=s.InventoryOut)
def remove_loose(list_name: str, item_id: int, db: Db = Depends(get_db)):
    item = get_or_404(db, m.LooseWeight, item_id)
    if item.kind != _loose_kind(list_name):
        raise HTTPException(404, "Not in that list.")
    db.delete(item)
    db.commit()
    return inventory_out(db)
