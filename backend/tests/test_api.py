import os
import tempfile

import pytest

os.environ["GYM_DB"] = os.path.join(tempfile.mkdtemp(), "test.db")

from fastapi.testclient import TestClient  # noqa: E402

from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.seed import seed_if_empty  # noqa: E402


@pytest.fixture()
def client():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        seed_if_empty(db)
    with TestClient(app) as c:
        yield c


def start(client, *people, day="2026-11-03"):
    r = client.post("/api/sessions", json={"date": day, "people": list(people)})
    assert r.status_code == 201, r.text
    return r.json()


def add_entry(client, participant_id, name):
    r = client.post(f"/api/participants/{participant_id}/entries", json={"name": name})
    assert r.status_code == 201, r.text
    return r.json()


def find_entry(sess, name, person=None):
    for p in sess["participants"]:
        if person and p["name"] != person:
            continue
        for e in p["entries"]:
            if e["name"] == name:
                return e
    raise AssertionError(name)


def test_seeded_inventory_and_cardio(client):
    inv = client.get("/api/inventory").json()
    assert [b["name"] for b in inv["bars"]] == ["Men's bar", "Women's bar", "EZ bar"]
    assert len(inv["bands"]) == 12 and inv["plates"][0]["kg"] == 20
    kinds = {e["name"]: e["kind"] for e in client.get("/api/exercises").json()}
    assert kinds == {"Run": "cardio", "Walk": "cardio"}


def test_session_people_are_unique(client):
    assert client.post("/api/sessions", json={"date": "2026-11-03", "people": ["Donn", "donn "]}).status_code == 409
    sess = start(client, "Donn")
    r = client.post(f"/api/sessions/{sess['id']}/participants", json={"name": "DONN"})
    assert r.status_code == 409
    sess = client.post(f"/api/sessions/{sess['id']}/participants", json={"name": "Sam"}).json()
    assert [p["name"] for p in sess["participants"]] == ["Donn", "Sam"]
    # Pointing Sam's column at Donn is refused too.
    sam = sess["participants"][1]
    assert client.patch(f"/api/participants/{sam['id']}", json={"name": "Donn"}).status_code == 409


def test_only_one_active_session(client):
    a = start(client, "Donn", day="2026-11-01")
    b = start(client, "Donn", day="2026-11-02")
    statuses = {s["id"]: s["status"] for s in client.get("/api/sessions").json()}
    assert statuses == {a["id"]: "finished", b["id"]: "active"}
    client.patch(f"/api/sessions/{a['id']}", json={"status": "active"})
    statuses = {s["id"]: s["status"] for s in client.get("/api/sessions").json()}
    assert statuses == {a["id"]: "active", b["id"]: "finished"}


def test_sets_prs_and_equipment_memory(client):
    sess = start(client, "Donn")
    pid = sess["participants"][0]["id"]
    sess = add_entry(client, pid, "Bench press")
    entry = find_entry(sess, "Bench press")
    assert entry["equipment_type"] == "weight"
    client.patch(f"/api/entries/{entry['id']}", json={"equipment_type": "barbell"})
    for reps, kg in ((5, 80), (3, 85), (1, 90)):
        r = client.post(f"/api/entries/{entry['id']}/sets", json={"reps": reps, "weight_kg": kg, "rir": 1})
        assert r.status_code == 201
    assert client.post(f"/api/entries/{entry['id']}/sets", json={"reps": 5}).status_code == 422

    prs = client.get("/api/stats/prs").json()
    assert prs[0]["person"] == "Donn" and prs[0]["weight_kg"] == 90

    best = client.get("/api/stats/best", params={"person_id": sess["participants"][0]["person_id"],
                                                 "exercise_id": entry["exercise_id"]}).json()
    assert [r["best"]["weight_kg"] if r["best"] else None for r in best["rows"][:6]] == [90, 85, 85, 80, 80, None]
    # Epley over reps 2-6 where present: 85*(1+2/30), 85*(1+3/30), 80*(1+4/30), 80*(1+5/30)
    expected = (85 * (1 + 2 / 30) + 85 * 1.1 + 80 * (1 + 4 / 30) + 80 * (1 + 5 / 30)) / 4
    assert abs(best["est_1rm"] - expected) < 1e-9

    # A new session remembers barbell for this exercise.
    sess2 = start(client, "Donn", day="2026-11-04")
    sess2 = add_entry(client, sess2["participants"][0]["id"], "bench PRESS")
    e2 = find_entry(sess2, "Bench press")
    assert e2["equipment_type"] == "barbell" and e2["exercise_id"] == entry["exercise_id"]


def test_move_sets(client):
    sess = start(client, "Donn")
    sess = add_entry(client, sess["participants"][0]["id"], "Squat")
    entry = find_entry(sess, "Squat")
    for reps in (6, 12, 7):
        sess = client.post(f"/api/entries/{entry['id']}/sets", json={"reps": reps, "weight_kg": 100}).json()
    last = find_entry(sess, "Squat")["sets"][-1]["id"]
    sess = client.post(f"/api/sets/{last}/move", json={"direction": "up"}).json()
    assert [st["reps"] for st in find_entry(sess, "Squat")["sets"]] == [6, 7, 12]
    sess = client.post(f"/api/sets/{last}/move", json={"direction": "up"}).json()
    sess = client.post(f"/api/sets/{last}/move", json={"direction": "up"}).json()  # already first: no change
    assert [st["reps"] for st in find_entry(sess, "Squat")["sets"]] == [7, 6, 12]
    sess = client.post(f"/api/sets/{last}/move", json={"direction": "down"}).json()
    assert [st["reps"] for st in find_entry(sess, "Squat")["sets"]] == [6, 7, 12]
    assert client.post(f"/api/sets/{last}/move", json={"direction": "left"}).status_code == 422


def test_band_sets_take_one_or_two_bands(client):
    bands = client.get("/api/inventory").json()["bands"]
    sess = start(client, "Donn")
    sess = add_entry(client, sess["participants"][0]["id"], "Banded pull-apart")
    entry = find_entry(sess, "Banded pull-apart")
    client.patch(f"/api/entries/{entry['id']}", json={"equipment_type": "band"})
    sess = client.post(f"/api/entries/{entry['id']}/sets",
                       json={"reps": 12, "band_ids": [bands[1]["id"], bands[2]["id"]]}).json()
    st = find_entry(sess, "Banded pull-apart")["sets"][0]
    assert st["band_ids"] == [bands[1]["id"], bands[2]["id"]] and st["weight_kg"] == 0
    sess = client.put(f"/api/sets/{st['id']}", json={"reps": 10, "band_ids": [bands[5]["id"]]}).json()
    st = find_entry(sess, "Banded pull-apart")["sets"][0]
    assert st["band_ids"] == [bands[5]["id"]] and st["reps"] == 10
    # No PR for weightless work.
    assert client.get("/api/stats/prs").json() == []
    # Removing a used band archives it, so the set still names it.
    inv = client.delete(f"/api/inventory/bands/{bands[5]['id']}").json()
    assert bands[5]["id"] in [b["id"] for b in inv["archived_bands"]]


def test_cardio_entries(client):
    sess = start(client, "Donn")
    run = next(e for e in client.get("/api/exercises").json() if e["name"] == "Run")
    walk = next(e for e in client.get("/api/exercises").json() if e["name"] == "Walk")
    r = client.post(f"/api/participants/{sess['participants'][0]['id']}/entries", json={"exercise_id": run["id"]})
    entry = find_entry(r.json(), "Run")
    assert entry["equipment_type"] == "cardio"
    assert client.post(f"/api/entries/{entry['id']}/sets", json={"duration_sec": 1800}).status_code == 422
    client.post(f"/api/entries/{entry['id']}/sets", json={"duration_sec": 1800, "distance_km": 5})
    sess = client.patch(f"/api/entries/{entry['id']}", json={"exercise_id": walk["id"]}).json()
    assert find_entry(sess, "Walk")["sets"][0]["distance_km"] == 5
    summary = {e["name"]: e for e in client.get("/api/exercises/summary").json()}
    assert summary["Walk"]["bests"][0]["distance_km"] == 5


def test_targets(client):
    sess = start(client, "Donn")
    sess = add_entry(client, sess["participants"][0]["id"], "Squat")
    entry = find_entry(sess, "Squat")
    client.post(f"/api/entries/{entry['id']}/sets", json={"reps": 5, "weight_kg": 100})
    person_id = sess["participants"][0]["person_id"]
    t = client.put("/api/targets", json={"person_id": person_id, "exercise_id": entry["exercise_id"],
                                         "weight_kg": 120, "reps": 5}).json()
    assert t["pct"] == 83 and not t["achieved"]
    t = client.put("/api/targets", json={"person_id": person_id, "exercise_id": entry["exercise_id"],
                                         "weight_kg": 100, "reps": 3}).json()
    assert t["achieved"] and len(client.get("/api/targets").json()) == 1


def test_rename_and_merge(client):
    sess = start(client, "Donn", "Sam")
    for p in sess["participants"]:
        sess = add_entry(client, p["id"], "Bench press")
    people = {p["name"]: p["id"] for p in client.get("/api/people").json()}
    assert client.patch(f"/api/people/{people['Sam']}", json={"name": "donn"}).status_code == 409
    assert client.patch(f"/api/people/{people['Sam']}", json={"name": "Samantha"}).status_code == 200
    # Can't merge two people who trained together in the same session.
    assert client.post(f"/api/people/{people['Sam']}/merge", json={"into_id": people["Donn"]}).status_code == 409
    sess2 = start(client, "Donnie", day="2026-11-05")
    donnie = sess2["participants"][0]["person_id"]
    assert client.post(f"/api/people/{donnie}/merge", json={"into_id": people["Donn"]}).status_code == 200
    names = [p["name"] for p in client.get(f"/api/sessions/{sess2['id']}").json()["participants"]]
    assert names == ["Donn"]

    sess2 = add_entry(client, sess2["participants"][0]["id"], "Bench")
    bench = find_entry(sess2, "Bench")["exercise_id"]
    main = find_entry(sess, "Bench press")["exercise_id"]
    client.post(f"/api/exercises/{bench}/merge", json={"into_id": main})
    assert find_entry(client.get(f"/api/sessions/{sess2['id']}").json(), "Bench press")


OLD_EXPORT = {
    "schemaVersion": 4,
    "sessions": [
        {"id": "abc", "date": "2026-10-01", "participants": [
            {"id": "p1", "name": "Donn", "exercises": [
                {"id": "e1", "name": "Bench press", "equipment": {"type": "barbell", "barId": "bar-ez"},
                 "notes": "felt good",
                 "sets": [{"setNumber": 1, "id": "s1", "reps": 5, "weight": 60, "rir": 2}]},
                {"id": "e2", "name": "Lat pulldown", "equipment": {"type": "band", "bandIds": ["band-power-red"]},
                 "sets": [{"id": "s2", "reps": 12, "weight": 0, "bandIds": ["band-power-red", "band-power-black"],
                           "band": "Power band · red + Power band · black"},
                          {"id": "s3", "reps": 10, "weight": 0, "bandId": "gone", "band": "Mini band · green"}]},
                {"id": "e3", "name": "Run", "equipment": {"type": "cardio", "activity": "run"},
                 "sets": [{"id": "s4", "durationSec": 1800, "distanceKm": 5}]},
            ]},
            {"id": "p2", "name": "Donn", "exercises": [
                {"id": "e4", "name": "Curl", "equipment": {"type": "dumbbell", "dumbbellCount": 2},
                 "sets": [{"id": "s5", "reps": 10, "weight": 7.5}]}]},
        ]},
    ],
    "plateInventory": {
        "bars": [{"id": "bar-mens", "name": "Men's bar", "kg": 20}, {"id": "bar-ez", "name": "EZ bar", "kg": 9.5}],
        "plates": [{"kg": 20, "count": 6}],
        "bands": [{"id": "band-power-red", "type": "Power band", "colour": "red", "strength": "Small", "count": 1},
                  {"id": "band-power-black", "type": "Power band", "colour": "black", "strength": "Large 1", "count": 1}],
    },
    "targets": [{"person": "Donn", "exercise": "Bench press", "weight": 80, "reps": 5, "setAt": "2026-09-01"}],
}


def test_import_old_export_then_export(client):
    r = client.post("/api/import", params={"mode": "replace"}, json=OLD_EXPORT)
    assert r.status_code == 200, r.text
    res = r.json()
    assert res["sessions"] == 1
    assert any("Donn (2)" in w for w in res["warnings"])  # duplicate person in one session
    # Replace drops bands the file doesn't list, so the old mini-band set can't be matched.
    assert any("Mini band · green" in w for w in res["warnings"])
    sess = client.get("/api/sessions").json()[0]
    assert sess["status"] == "finished"
    assert [p["name"] for p in sess["participants"]] == ["Donn", "Donn (2)"]
    bench = find_entry(sess, "Bench press")
    inv = client.get("/api/inventory").json()
    ez = next(b for b in inv["bars"] if b["name"] == "EZ bar")
    assert bench["equipment_type"] == "barbell" and bench["bar_id"] == ez["id"] and bench["notes"] == "felt good"
    assert [b["name"] for b in inv["bars"]] == ["Men's bar", "EZ bar"]
    assert inv["plates"] == [{"id": inv["plates"][0]["id"], "kg": 20, "count": 6}]
    band_sets = find_entry(sess, "Lat pulldown")["sets"]
    assert len(band_sets[0]["band_ids"]) == 2
    assert find_entry(sess, "Run")["sets"][0]["distance_km"] == 5
    assert client.get("/api/targets").json()[0]["weight_kg"] == 80

    # Re-importing the same file in merge mode updates rather than duplicates.
    client.post("/api/import", params={"mode": "merge"}, json=OLD_EXPORT)
    assert len(client.get("/api/sessions").json()) == 1

    exported = client.get("/api/export").json()
    assert exported["schemaVersion"] == 4
    ex = exported["sessions"][0]["participants"][0]["exercises"]
    assert ex[0]["sets"][0] == {"setNumber": 1, "id": ex[0]["sets"][0]["id"], "reps": 5, "weight": 60, "rir": 2}
    assert ex[1]["sets"][0]["band"] == "Power band · red + Power band · black"
    assert ex[2]["equipment"] == {"type": "cardio", "activity": "run"}

    # And our own export round-trips into a fresh database.
    client.post("/api/import", params={"mode": "replace"}, json=exported)
    again = client.get("/api/export").json()
    strip = lambda d: [[[(e["name"], [{k: v for k, v in s.items() if k != "id"} for s in e["sets"]])  # noqa: E731
                         for e in p["exercises"]] for p in sess["participants"]] for sess in d["sessions"]]
    assert strip(again) == strip(exported)
