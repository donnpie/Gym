"""JSON export / import.

The export keeps the old browser app's shape (schemaVersion 4) so the Power BI
report and any scripts reading it keep working. Import accepts that shape —
from the old app or this one — in "replace" or "merge" mode.
"""
from datetime import date, datetime
from typing import Any, Literal

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session as Db

from .. import models as m
from .. import schemas as s
from ..db import get_db
from ..seed import seed_cardio
from ..services import SESSION_LOAD, get_or_create_exercise, get_or_create_person

router = APIRouter(prefix="/api", tags=["data"])

SCHEMA_VERSION = 4


def _num(v):
    return int(v) if isinstance(v, float) and v.is_integer() else v


def _session_key(sess: m.Session) -> str:
    return sess.legacy_id or f"db-{sess.id}"


@router.get("/export")
def export_all(db: Db = Depends(get_db)) -> dict[str, Any]:
    bands = {b.id: b for b in db.scalars(select(m.Band))}
    band_label = lambda b: " · ".join(x for x in (b.type, b.colour) if x)  # noqa: E731
    sessions = []
    for sess in db.scalars(select(m.Session).options(*SESSION_LOAD).order_by(m.Session.date, m.Session.id)):
        participants = []
        for p in sess.participants:
            exercises = []
            for e in p.entries:
                eq: dict[str, Any] | None = None
                if e.equipment_type == "cardio":
                    eq = {"type": "cardio", "activity": e.exercise.name.lower()}
                elif e.equipment_type == "barbell":
                    eq = {"type": "barbell", **({"barId": str(e.bar_id)} if e.bar_id else {})}
                elif e.equipment_type == "dumbbell":
                    eq = {"type": "dumbbell", "dumbbellCount": e.dumbbell_count}
                elif e.equipment_type in ("plates", "band", "bodyweight"):
                    eq = {"type": e.equipment_type}
                sets = []
                for i, w in enumerate(e.sets):
                    row: dict[str, Any] = {"setNumber": i + 1, "id": str(w.id)}
                    if e.equipment_type == "cardio":
                        row.update(durationSec=w.duration_sec, distanceKm=w.distance_km)
                    else:
                        row.update(reps=w.reps, weight=_num(w.weight_kg))
                        if w.rir is not None:
                            row["rir"] = w.rir
                        if w.bands:
                            row["bandIds"] = [str(b.band_id) for b in w.bands]
                            row["band"] = " + ".join(band_label(bands[b.band_id]) for b in w.bands)
                    sets.append(row)
                ex: dict[str, Any] = {"id": str(e.id), "name": e.exercise.name, "sets": sets}
                if eq:
                    ex["equipment"] = eq
                if e.notes:
                    ex["notes"] = e.notes
                exercises.append(ex)
            participants.append({"id": str(p.id), "name": p.person.name, "exercises": exercises})
        sessions.append({"id": _session_key(sess), "date": sess.date.isoformat(), "participants": participants})

    loose = lambda kind: [{"kg": _num(x.kg), "count": x.count} for x in db.scalars(  # noqa: E731
        select(m.LooseWeight).where(m.LooseWeight.kind == kind).order_by(m.LooseWeight.kg))]
    targets = db.execute(
        select(m.Person.name, m.Exercise.name, m.Target.weight_kg, m.Target.reps, m.Target.set_at)
        .join(m.Person, m.Target.person_id == m.Person.id)
        .join(m.Exercise, m.Target.exercise_id == m.Exercise.id))
    return {
        "exportedAt": datetime.now().isoformat(timespec="seconds"),
        "schemaVersion": SCHEMA_VERSION,
        "sessions": sessions,
        "plateInventory": {
            "bars": [{"id": str(b.id), "name": b.name, "kg": _num(b.kg)} for b in db.scalars(
                select(m.Bar).where(m.Bar.archived.is_(False)).order_by(m.Bar.position, m.Bar.id))],
            "plates": list(reversed(loose("plate"))),
            "dumbbells": loose("dumbbell"),
            "kettlebells": loose("kettlebell"),
            "accessories": [{"id": str(a.id), "name": a.name, "count": a.count}
                            for a in db.scalars(select(m.Accessory).order_by(m.Accessory.position))],
            "bands": [{"id": str(b.id), "type": b.type, "colour": b.colour, "strength": b.strength,
                       "count": b.count} for b in bands.values() if not b.archived],
        },
        "targets": [{"person": p, "exercise": e, "weight": _num(w), "reps": r, "setAt": d.isoformat()}
                    for p, e, w, r, d in targets],
        "people": [p.name for p in db.scalars(select(m.Person).order_by(m.Person.name))],
        "exercises": [{"name": e.name, "kind": e.kind} for e in db.scalars(select(m.Exercise).order_by(m.Exercise.name))],
    }


# ---------- Import ----------

def _key(*parts) -> str:
    return "|".join(" ".join(str(p or "").split()).lower() for p in parts)


class Importer:
    def __init__(self, db: Db, replace: bool):
        self.db, self.replace = db, replace
        self.warnings: list[str] = []
        self.bar_ids: dict[str, int] = {}   # file id -> db id
        self.band_ids: dict[str, int] = {}

    def warn(self, msg: str) -> None:
        if msg not in self.warnings:
            self.warnings.append(msg)

    # --- inventory ---

    def inventory(self, inv: dict | None) -> None:
        inv = inv if isinstance(inv, dict) else {}
        db = self.db
        existing_bars = db.scalars(select(m.Bar)).all()
        existing_bands = db.scalars(select(m.Band)).all()
        # Map ids even for lists the file doesn't include, so sets can still resolve them by name.
        if isinstance(inv.get("bars"), list):
            seen = set()
            for i, b in enumerate(x for x in inv["bars"] if isinstance(x, dict)):
                match = next((x for x in existing_bars if _key(x.name) == _key(b.get("name"))), None)
                if not match:
                    match = m.Bar()
                    db.add(match)
                    existing_bars.append(match)
                match.name, match.kg, match.archived = b.get("name") or "", float(b.get("kg") or 0), False
                if self.replace:
                    match.position = i
                db.flush()
                seen.add(match.id)
                if b.get("id") is not None:
                    self.bar_ids[str(b["id"])] = match.id
            if self.replace:
                for x in existing_bars:
                    if x.id not in seen:
                        x.archived = True
        if isinstance(inv.get("bands"), list):
            seen = set()
            for i, b in enumerate(x for x in inv["bands"] if isinstance(x, dict)):
                match = next((x for x in existing_bands
                              if _key(x.type, x.colour) == _key(b.get("type"), b.get("colour"))), None)
                if not match:
                    match = m.Band(position=len(existing_bands))
                    db.add(match)
                    existing_bands.append(match)
                match.type, match.colour = b.get("type") or "", b.get("colour") or ""
                match.strength, match.count = b.get("strength") or "", int(b.get("count") or 0)
                match.archived = False
                if self.replace:
                    match.position = i
                db.flush()
                seen.add(match.id)
                if b.get("id") is not None:
                    self.band_ids[str(b["id"])] = match.id
            if self.replace:
                for x in existing_bands:
                    if x.id not in seen:
                        if db.scalar(select(m.SetBand.set_id).where(m.SetBand.band_id == x.id).limit(1)):
                            x.archived = True
                        else:
                            db.delete(x)
        for list_name, kind in (("plates", "plate"), ("dumbbells", "dumbbell"), ("kettlebells", "kettlebell")):
            rows = inv.get(list_name)
            if not isinstance(rows, list):
                continue
            current = db.scalars(select(m.LooseWeight).where(m.LooseWeight.kind == kind)).all()
            if self.replace:
                for x in current:
                    db.delete(x)
                current = []
            for r in (x for x in rows if isinstance(x, dict)):
                kg = float(r.get("kg") or 0)
                match = next((x for x in current if abs(x.kg - kg) < 1e-4), None)
                if not match:
                    match = m.LooseWeight(kind=kind, kg=kg)
                    db.add(match)
                    current.append(match)
                match.count = int(r.get("count") or 0)
        if isinstance(inv.get("accessories"), list):
            current = db.scalars(select(m.Accessory)).all()
            if self.replace:
                for x in current:
                    db.delete(x)
                current = []
            for i, a in enumerate(x for x in inv["accessories"] if isinstance(x, dict)):
                match = next((x for x in current if _key(x.name) == _key(a.get("name"))), None)
                if not match:
                    match = m.Accessory(position=len(current) + i)
                    db.add(match)
                    current.append(match)
                match.name, match.count = a.get("name") or "", int(a.get("count") or 0)
        db.flush()

    def resolve_band(self, file_id, label: str | None) -> int | None:
        if file_id is not None and str(file_id) in self.band_ids:
            return self.band_ids[str(file_id)]
        if file_id is not None and str(file_id).isdigit():
            band = self.db.get(m.Band, int(file_id))  # an export from this app
            if band:
                return band.id
        # Old sets keep a "Type · colour" label; match on that.
        if label:
            for band in self.db.scalars(select(m.Band)):
                if _key(" · ".join(x for x in (band.type, band.colour) if x)) == _key(label):
                    return band.id
        return None

    # --- sessions ---

    def session(self, raw: dict) -> None:
        db = self.db
        legacy = str(raw.get("id")) if raw.get("id") is not None else None
        existing = None
        if legacy and legacy.startswith("db-") and legacy[3:].isdigit():
            existing = db.get(m.Session, int(legacy[3:]))
            legacy = None if existing else legacy
        elif legacy:
            existing = db.scalar(select(m.Session).where(m.Session.legacy_id == legacy))
        if existing:
            db.delete(existing)
            db.flush()
        try:
            day = date.fromisoformat(str(raw.get("date"))[:10])
        except ValueError:
            self.warn(f"Skipped a session with an unreadable date ({raw.get('date')!r}).")
            return
        sess = m.Session(date=day, status="finished", legacy_id=legacy)
        db.add(sess)
        db.flush()

        participants = raw.get("participants")
        if not isinstance(participants, list) and isinstance(raw.get("exercises"), list):
            participants = [{"name": "Me", "exercises": raw["exercises"]}]  # oldest single-person shape
        used: set[int] = set()
        for pos, p in enumerate(x for x in participants or [] if isinstance(x, dict)):
            name = (p.get("name") or "").strip() or f"Person {pos + 1}"
            person = get_or_create_person(db, name)
            n = 2
            while person.id in used:
                # Same person twice in one session: keep both workouts, under a separate name.
                alt = f"{name} ({n})"
                self.warn(f"{name} appeared twice on {day}; the second one was imported as {alt}. "
                          "Rename or merge them under People.")
                person = get_or_create_person(db, alt)
                n += 1
            used.add(person.id)
            part = m.Participant(session_id=sess.id, person_id=person.id, position=pos)
            db.add(part)
            db.flush()
            for epos, ex in enumerate(x for x in p.get("exercises") or [] if isinstance(x, dict)):
                self.entry(part, epos, ex)

    def entry(self, part: m.Participant, pos: int, raw: dict) -> None:
        db = self.db
        eq = raw.get("equipment") if isinstance(raw.get("equipment"), dict) else {}
        etype = eq.get("type") or ("barbell" if raw.get("showPlates") else "weight")
        if etype not in m.EQUIPMENT_TYPES:
            etype = "weight"
        cardio = etype == "cardio"
        name = (raw.get("name") or "").strip() or ("Run" if cardio else "Exercise")
        ex = get_or_create_exercise(db, name, "cardio" if cardio else "strength")
        if (ex.kind == "cardio") != cardio:
            alt = f"{name} ({'cardio' if cardio else 'strength'})"
            self.warn(f'"{name}" was logged both as cardio and as strength; some entries were imported as "{alt}".')
            ex = get_or_create_exercise(db, alt, "cardio" if cardio else "strength")
        bar_id = None
        if etype == "barbell" and eq.get("barId") is not None:
            bar_id = self.bar_ids.get(str(eq["barId"]))
            if bar_id is None and str(eq["barId"]).isdigit() and db.get(m.Bar, int(eq["barId"])):
                bar_id = int(eq["barId"])
        entry = m.Entry(participant_id=part.id, exercise_id=ex.id, position=pos, equipment_type=etype,
                        bar_id=bar_id, dumbbell_count=1 if eq.get("dumbbellCount") == 1 else 2,
                        notes=raw.get("notes") or "")
        db.add(entry)
        db.flush()

        sets = raw.get("sets")
        if not isinstance(sets, list):  # oldest shape: sets was a count with one reps/weight
            sets = [{"reps": raw.get("reps"), "weight": raw.get("weight")}] * int(sets or 1)
        for spos, st in enumerate(x for x in sets if isinstance(x, dict)):
            ws = m.WorkSet(entry_id=entry.id, position=spos)
            if cardio:
                ws.duration_sec = int(st.get("durationSec") or 0) or None
                ws.distance_km = float(st.get("distanceKm") or 0) or None
            else:
                ws.reps = int(st["reps"]) if st.get("reps") not in (None, "") else None
                ws.weight_kg = float(st.get("weight") or 0)
                ws.rir = int(st["rir"]) if st.get("rir") not in (None, "") else None
                ids = st.get("bandIds") if isinstance(st.get("bandIds"), list) else (
                    [st["bandId"]] if st.get("bandId") else [])
                labels = str(st.get("band") or "").split(" + ")
                for bpos, bid in enumerate(ids[:2]):
                    label = labels[bpos] if bpos < len(labels) else None
                    resolved = self.resolve_band(bid, label)
                    if resolved:
                        ws.bands.append(m.SetBand(position=bpos, band_id=resolved))
                    else:
                        self.warn(f"Couldn't find the band \"{label or bid}\" in the inventory; "
                                  "those sets were imported without it.")
            db.add(ws)

    def targets(self, rows) -> None:
        if not isinstance(rows, list):
            return
        db = self.db
        for t in (x for x in rows if isinstance(x, dict)):
            if not t.get("person") or not t.get("exercise") or not t.get("weight") or not t.get("reps"):
                continue
            person = get_or_create_person(db, t["person"])
            ex = get_or_create_exercise(db, t["exercise"])
            row = db.scalar(select(m.Target).where(m.Target.person_id == person.id,
                                                   m.Target.exercise_id == ex.id))
            if not row:
                row = m.Target(person_id=person.id, exercise_id=ex.id)
                db.add(row)
            row.weight_kg, row.reps = float(t["weight"]), int(t["reps"])
            try:
                row.set_at = date.fromisoformat(str(t.get("setAt"))[:10])
            except ValueError:
                row.set_at = date.today()
            db.flush()

    def remember_equipment(self) -> None:
        """Each exercise defaults to the equipment of its most recent entry."""
        db = self.db
        for ex in db.scalars(select(m.Exercise)):
            last = db.scalar(select(m.Entry).join(m.Participant).join(m.Session)
                             .where(m.Entry.exercise_id == ex.id)
                             .order_by(m.Session.date.desc(), m.Entry.id.desc()).limit(1))
            if last:
                ex.equipment_type = last.equipment_type


@router.post("/import", response_model=s.ImportResult)
def import_all(
    mode: Literal["replace", "merge"] = "merge",
    payload: Any = Body(...),
    db: Db = Depends(get_db),
):
    data = {"sessions": payload} if isinstance(payload, list) else payload
    if not isinstance(data, dict) or not isinstance(data.get("sessions"), list):
        raise HTTPException(422, "No sessions found. Expected an export from this app.")
    replace = mode == "replace"
    if replace:
        for model in (m.Session, m.Target):
            db.execute(delete(model))
        db.flush()
        for model in (m.Exercise, m.Person):
            db.execute(delete(model))
        seed_cardio(db)
        db.flush()
    imp = Importer(db, replace)
    imp.inventory(data.get("plateInventory"))
    sessions = [x for x in data["sessions"] if isinstance(x, dict)]
    for raw in sessions:
        imp.session(raw)
    imp.targets(data.get("targets"))
    imp.remember_equipment()
    db.commit()
    return s.ImportResult(sessions=len(sessions), warnings=imp.warnings)
