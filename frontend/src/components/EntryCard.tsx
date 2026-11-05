import { useRef, useState } from "react";
import { api } from "../api";
import {
  EQUIPMENT_LABELS, RIR_TOOLTIP, WEIGHT_TOOLTIP, cardioSummary, cardioTotals, entryVolume, fmt, fmtDist,
  formatDuration, kmToUnit, parseDuration, resolveBar, sameName, setBandLabel, speedText, unitToKm,
} from "../format";
import { useStore } from "../store";
import type { Entry, EquipmentType, Participant, Session, WorkSet } from "../types";
import { Caret, UnitToggle, num } from "./common";
import { BandPicker, PRCalc, PlatesHint } from "./widgets";

const STRENGTH_EQUIPMENT: EquipmentType[] = ["weight", "barbell", "plates", "dumbbell", "band", "bodyweight"];

/** The band(s) this person last used for this exercise, so a new entry starts there. */
function lastBandIds(sessions: Session[], personId: number, exerciseId: number): number[] | null {
  for (const s of sessions) {  // newest first
    for (const p of s.participants) {
      if (p.person_id !== personId) continue;
      for (const e of [...p.entries].reverse()) {
        if (e.exercise_id !== exerciseId) continue;
        const set = [...e.sets].reverse().find(x => x.band_ids.length);
        if (set) return set.band_ids;
      }
    }
  }
  return null;
}

export function EntryCard({ participant, entry, isActive }: {
  participant: Participant; entry: Entry; isActive: boolean;
}) {
  const store = useStore();
  const { run, inventory, exercises, isCollapsed, toggleCollapsed, distanceUnit } = store;
  const key = `ex:${entry.id}`;
  const collapsed = isCollapsed(key);
  const cardio = entry.equipment_type === "cardio";
  const eq = entry.equipment_type;
  const band = eq === "band";

  const last = entry.sets[entry.sets.length - 1];
  const [reps, setReps] = useState(last?.reps != null ? String(last.reps) : "");
  const [weight, setWeight] = useState(last?.weight_kg != null && !band ? String(last.weight_kg) : "");
  const [rir, setRir] = useState(last?.rir != null ? String(last.rir) : "");
  const [bandIds, setBandIds] = useState<number[]>(() =>
    last?.band_ids.length ? last.band_ids
      : lastBandIds(store.sessions, participant.person_id, entry.exercise_id)
        ?? (inventory.bands.length ? [inventory.bands[0].id] : []));
  const [duration, setDuration] = useState("");
  const [distance, setDistance] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [prOpen, setPrOpen] = useState(false);
  const [editingSetId, setEditingSetId] = useState<number | null>(null);
  const repsRef = useRef<HTMLInputElement>(null);
  const durRef = useRef<HTMLInputElement>(null);

  const pr = cardio ? undefined : store.prFor(participant.person_id, entry.exercise_id);
  const target = cardio ? undefined : store.targetFor(participant.person_id, entry.exercise_id);
  const bar = resolveBar(entry, inventory);

  const addSet = async () => {
    const r = num(reps);
    let w = num(weight);
    if (w == null && (eq === "bodyweight" || band)) w = 0;
    if (!r || w == null) {
      alert(band ? "Enter reps." : "Enter reps and weight.");
      return;
    }
    await run(() => api.addSet(entry.id, { reps: r, weight_kg: band ? 0 : w, rir: num(rir), band_ids: band ? bandIds : [] }));
    repsRef.current?.focus();
  };

  const addCardio = async () => {
    const durationSec = parseDuration(duration);
    const distanceKm = unitToKm(num(distance) ?? NaN, distanceUnit);
    if (!durationSec || !(distanceKm > 0)) {
      alert(`Enter a duration (e.g. 28:30) and a distance in ${distanceUnit}.`);
      return;
    }
    const ok = await run(() => api.addSet(entry.id, { duration_sec: durationSec, distance_km: distanceKm }));
    if (ok) {
      setDuration("");
      setDistance("");
      durRef.current?.focus();
    }
  };

  const updateEntry = (body: Record<string, unknown>) => run(() => api.updateEntry(entry.id, body));

  const remove = () => {
    if (entry.sets.length && !confirm(`Remove "${entry.name}" and its ${entry.sets.length} set(s)?`)) return;
    run(() => api.deleteEntry(entry.id));
  };

  // ----- Header -----

  let equipControls = null;
  if (cardio) {
    const cardioExercises = exercises.filter(e => e.kind === "cardio");
    equipControls = (
      <>
        {" "}
        <select className="activity-select" title="Type of cardio" value={entry.exercise_id}
          onChange={e => updateEntry({ exercise_id: Number(e.target.value) })}>
          {cardioExercises.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>{" "}
        <UnitToggle />
      </>
    );
  } else if (isActive) {
    equipControls = (
      <>
        {" "}
        <select className="equip-select" title="Equipment type for this exercise" value={eq}
          onChange={e => updateEntry({ equipment_type: e.target.value })}>
          {STRENGTH_EQUIPMENT.map(t => <option key={t} value={t}>{EQUIPMENT_LABELS[t]}</option>)}
        </select>
        {eq === "barbell" && (
          <>
            {" "}
            <select className="bar-select" title="Which bar you're using — affects the plate breakdown"
              value={bar.id} onChange={e => updateEntry({ bar_id: Number(e.target.value) })}>
              {inventory.bars.filter(b => b.kg > 0).map(b => <option key={b.id} value={b.id}>{b.name} ({b.kg} kg)</option>)}
            </select>
          </>
        )}
        {eq === "dumbbell" && [1, 2].map(n => (
          <button key={n} className={`db-count-btn${(entry.dumbbell_count || 2) === n ? " active" : ""}`}
            title="Number of dumbbells" onClick={() => updateEntry({ dumbbell_count: n })}>×{n}</button>
        ))}
      </>
    );
  } else if (eq !== "weight") {
    const label = eq === "barbell" ? `Barbell · ${bar.name}`
      : eq === "dumbbell" ? `Dumbbell ×${entry.dumbbell_count || 2}` : EQUIPMENT_LABELS[eq];
    equipControls = <> <span className="equip-tag">{label}</span></>;
  }

  let targetTag = null;
  if (target) {
    const title = target.achieved ? "Target achieved"
      : `Target — best so far: ${target.best ? `${target.best.weight_kg} kg` : "none"} at ${target.reps}+ reps`;
    targetTag = <> <span className={`target-tag${target.achieved ? " achieved" : ""}`} title={title}>Target: {target.weight_kg} kg × {target.reps}</span></>;
  }

  // ----- Body -----

  const total = cardio
    ? (entry.sets.length > 1 && (t => (
      <div className="exercise-total" title="Total distance and time; average speed over the whole thing">
        Total: {cardioSummary(t.distanceKm, t.durationSec, distanceUnit)}
      </div>))(cardioTotals(entry)))
    : entry.sets.length > 0 && <div className="exercise-total">Total: {fmt(entryVolume(entry))} kg</div>;

  const showNotesEditor = isActive || editingNotes;
  const weightLabel = eq === "dumbbell" ? "Weight/DB (kg)" : eq === "bodyweight" ? "Added (kg)" : "Weight (kg)";
  const weightTip = eq === "dumbbell" ? "Weight of one dumbbell — volume counts both when ×2"
    : eq === "bodyweight" ? "Added weight only (belt/vest) — leave 0 for pure bodyweight"
    : eq === "plates" ? "Total weight of the plates (no bar)" : WEIGHT_TOOLTIP;
  const onEnter = (fn: () => void) => (e: React.KeyboardEvent) => { if (e.key === "Enter") fn(); };

  return (
    <div className={`exercise-card collapsible${collapsed ? " collapsed" : ""}`} data-exid={entry.id}>
      <div className="exercise-header collapsible-head">
        <Caret collapsed={collapsed} onClick={() => toggleCollapsed(key)} />
        <div className="exercise-title">
          {renaming ? (
            <RenameExercise entry={entry} onDone={() => setRenaming(false)} />
          ) : (
            <>
              <button className="exercise-name-btn" onClick={() => setRenaming(true)}
                title="Click to rename this exercise everywhere">{entry.name}</button>
              {pr && <> <button className="pr-tag" onClick={() => setPrOpen(o => !o)}
                title="Click for working weights at 50–100% of PR">(PR: {pr.weight_kg} kg)</button></>}
              {targetTag}
              {equipControls}
            </>
          )}
        </div>
        <button className="danger small" onClick={remove} title="Remove exercise">×</button>
      </div>
      {!collapsed && (
        <>
          {!renaming && pr && prOpen && <PRCalc weight={pr.weight_kg} />}
          <div className="sets-list">
            {entry.sets.length === 0
              ? <div className="empty small">{cardio ? "Nothing logged" : "No sets"}{isActive || cardio ? " yet" : ""}.</div>
              : entry.sets.map((s, i) => cardio
                ? <CardioRow key={s.id} set={s} index={i} count={entry.sets.length} editing={editingSetId === s.id} onEdit={setEditingSetId} />
                : <SetRow key={s.id} set={s} index={i} count={entry.sets.length} band={band} editing={editingSetId === s.id}
                  onEdit={setEditingSetId} />)}
          </div>
          {total}
          {showNotesEditor ? (
            <div className="exercise-notes">
              <label className="notes-label">Notes</label>
              <textarea
                className="notes-input"
                placeholder="Form cues, RPE, equipment, anything worth remembering…"
                defaultValue={entry.notes}
                autoFocus={editingNotes}
                onBlur={e => {
                  if (e.target.value !== entry.notes) updateEntry({ notes: e.target.value });
                  setEditingNotes(false);
                }}
                onKeyDown={e => {
                  if (e.key === "Escape") {
                    e.currentTarget.value = entry.notes;
                    e.currentTarget.blur();
                  }
                }}
              />
            </div>
          ) : entry.notes.trim() && (
            <div className="exercise-notes read-only">
              <label className="notes-label">Notes</label>
              <button className="notes-display-btn" title="Click to edit" onClick={() => setEditingNotes(true)}>{entry.notes}</button>
            </div>
          )}
          {cardio ? (
            // Cardio stays editable in past sessions without resuming.
            <div className="add-set-form cardio">
              <div>
                <label title="h:mm:ss, mm:ss, or minutes">Duration</label>
                <input ref={durRef} type="text" className="cardio-input-duration" placeholder="e.g. 28:30" inputMode="numeric"
                  title="h:mm:ss, mm:ss, or minutes" value={duration} onChange={e => setDuration(e.target.value)} onKeyDown={onEnter(addCardio)} />
              </div>
              <div>
                <label>Distance ({distanceUnit})</label>
                <input type="number" className="cardio-input-distance" min="0" step="0.01" placeholder={`e.g. ${distanceUnit === "mi" ? "3.1" : "5"}`}
                  value={distance} onChange={e => setDistance(e.target.value)} onKeyDown={onEnter(addCardio)} />
              </div>
              <div className="cardio-preview">
                {(() => {
                  const sec = parseDuration(duration);
                  const km = unitToKm(num(distance) ?? NaN, distanceUnit);
                  return sec && km > 0 ? `Avg speed: ${speedText(km, sec, distanceUnit)}` : "";
                })()}
              </div>
              <button className="add-set-btn" onClick={addCardio}>Add</button>
            </div>
          ) : isActive && (
            <>
              <div className="add-set-form">
                <div>
                  <label>Reps</label>
                  <input ref={repsRef} type="number" className="set-input-reps" min="1" value={reps}
                    onChange={e => setReps(e.target.value)} onKeyDown={onEnter(addSet)} />
                </div>
                {band ? (
                  <div className="band-picker-wrap">
                    <label>Band</label>
                    <BandPicker value={bandIds} onChange={setBandIds} onEnter={addSet} />
                  </div>
                ) : (
                  <div>
                    <label title={weightTip}>{weightLabel}</label>
                    <input type="number" className="set-input-weight" min="0" step="0.5" value={weight} title={weightTip}
                      onChange={e => setWeight(e.target.value)} onKeyDown={onEnter(addSet)} />
                  </div>
                )}
                <div>
                  <label title={RIR_TOOLTIP}>RIR</label>
                  <input type="number" className="set-input-rir" min="0" max="10" value={rir} title={RIR_TOOLTIP} placeholder="opt."
                    onChange={e => setRir(e.target.value)} onKeyDown={onEnter(addSet)} />
                </div>
                <button className="add-set-btn" onClick={addSet}>Add set</button>
              </div>
              {eq === "barbell" && <div className="plates-hint-root"><PlatesHint weight={num(weight)} barKg={bar.kg} /></div>}
              {eq === "plates" && <div className="plates-hint-root"><PlatesHint weight={num(weight)} barKg={null} /></div>}
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Renames the exercise everywhere, or — if the name is another exercise — logs this entry as that one. */
function RenameExercise({ entry, onDone }: { entry: Entry; onDone: () => void }) {
  const { run, exercises } = useStore();
  const [name, setName] = useState(entry.name);
  const save = async () => {
    const n = name.trim();
    if (!n || n === entry.name) return onDone();
    const other = exercises.find(e => e.id !== entry.exercise_id && sameName(e.name, n));
    if (other) {
      if (confirm(`"${other.name}" already exists. Log this entry as ${other.name}?\n\n`
        + `(To combine every "${entry.name}" with "${other.name}", use Merge in the Exercises section.)`)) {
        await run(() => api.updateEntry(entry.id, { exercise_id: other.id }));
      }
    } else {
      await run(() => api.renameExercise(entry.exercise_id, n));
    }
    onDone();
  };
  return (
    <div className="rename-form">
      <input type="text" className="rename-input" value={name} list="known-exercises" autoComplete="off" autoFocus
        onFocus={e => e.target.select()} onChange={e => setName(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter") { e.preventDefault(); save(); }
          if (e.key === "Escape") onDone();
        }} />
      <button className="rename-save" onClick={save}>Save</button>
      <button className="secondary rename-cancel" onClick={onDone}>Cancel</button>
    </div>
  );
}

/** ▲ ▼ buttons to move a set within its exercise; hidden at the ends. */
function MoveButtons({ set, index, count }: { set: WorkSet; index: number; count: number }) {
  const { run } = useStore();
  if (count < 2) return null;
  return (
    <span className="set-move">
      <button className="set-move-btn" title="Move up" disabled={index === 0}
        onClick={() => run(() => api.moveSet(set.id, "up"))}>▲</button>
      <button className="set-move-btn" title="Move down" disabled={index === count - 1}
        onClick={() => run(() => api.moveSet(set.id, "down"))}>▼</button>
    </span>
  );
}

function SetRow({ set, index, count, band, editing, onEdit }: {
  set: WorkSet; index: number; count: number; band: boolean; editing: boolean; onEdit: (id: number | null) => void;
}) {
  const { run, inventory } = useStore();
  const [reps, setReps] = useState(String(set.reps ?? ""));
  const [weight, setWeight] = useState(String(set.weight_kg ?? ""));
  const [rir, setRir] = useState(set.rir != null ? String(set.rir) : "");
  const [bandIds, setBandIds] = useState(set.band_ids);

  const startEdit = () => {
    setReps(String(set.reps ?? ""));
    setWeight(String(set.weight_kg ?? ""));
    setRir(set.rir != null ? String(set.rir) : "");
    setBandIds(set.band_ids);
    onEdit(set.id);
  };
  const save = async () => {
    const r = num(reps);
    const w = band ? 0 : num(weight);
    if (!r || w == null) {
      alert(band ? "Enter reps." : "Enter reps and weight.");
      return;
    }
    const ok = await run(() => api.replaceSet(set.id, { reps: r, weight_kg: w, rir: num(rir), band_ids: band ? bandIds : [] }));
    if (ok) onEdit(null);
  };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") save();
    if (e.key === "Escape") onEdit(null);
  };

  if (editing) {
    return (
      <div className="set-row editing">
        <span className="set-num">{index + 1}.</span>
        <div className="set-edit-form">
          <input type="number" className="edit-reps" min="1" value={reps} placeholder="reps" autoFocus
            onChange={e => setReps(e.target.value)} onKeyDown={keys} />
          {band
            ? <BandPicker value={bandIds} onChange={setBandIds} onEnter={save} />
            : <input type="number" className="edit-weight" min="0" step="0.5" value={weight} placeholder="kg" title={WEIGHT_TOOLTIP}
              onChange={e => setWeight(e.target.value)} onKeyDown={keys} />}
          <input type="number" className="edit-rir" min="0" max="10" value={rir} placeholder="RIR" title={RIR_TOOLTIP}
            onChange={e => setRir(e.target.value)} onKeyDown={keys} />
          <button className="save-edit" onClick={save}>Save</button>
          <button className="secondary cancel-edit" onClick={() => onEdit(null)}>Cancel</button>
        </div>
      </div>
    );
  }
  return (
    <div className="set-row">
      <span className="set-num">{index + 1}.</span>
      <button className="set-summary-btn" title="Click to edit" onClick={startEdit}>
        {set.reps} × {band || set.band_ids.length ? setBandLabel(set.band_ids, inventory) : `${set.weight_kg} kg`}
        {set.rir != null && <> <span className="rir-tag">RIR {set.rir}</span></>}
      </button>
      <MoveButtons set={set} index={index} count={count} />
      <button className="danger small" title="Remove set" onClick={() => run(() => api.deleteSet(set.id))}>×</button>
    </div>
  );
}

function CardioRow({ set, index, count, editing, onEdit }: {
  set: WorkSet; index: number; count: number; editing: boolean; onEdit: (id: number | null) => void;
}) {
  const { run, distanceUnit } = useStore();
  const [duration, setDuration] = useState("");
  const [distance, setDistance] = useState("");
  const km = set.distance_km || 0;
  const sec = set.duration_sec || 0;

  const startEdit = () => {
    setDuration(formatDuration(sec));
    setDistance(String(Math.round(kmToUnit(km, distanceUnit) * 100) / 100));
    onEdit(set.id);
  };
  const save = async () => {
    const durationSec = parseDuration(duration);
    const distanceKm = unitToKm(num(distance) ?? NaN, distanceUnit);
    if (!durationSec || !(distanceKm > 0)) {
      alert(`Enter a duration (e.g. 28:30) and a distance in ${distanceUnit}.`);
      return;
    }
    const ok = await run(() => api.replaceSet(set.id, { duration_sec: durationSec, distance_km: distanceKm }));
    if (ok) onEdit(null);
  };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") save();
    if (e.key === "Escape") onEdit(null);
  };

  if (editing) {
    return (
      <div className="set-row editing">
        <span className="set-num">{index + 1}.</span>
        <div className="set-edit-form cardio">
          <input type="text" className="edit-duration" value={duration} placeholder="mm:ss" title="h:mm:ss, mm:ss, or minutes" autoFocus
            onChange={e => setDuration(e.target.value)} onKeyDown={keys} />
          <input type="number" className="edit-distance" min="0" step="0.01" value={distance} placeholder={distanceUnit}
            onChange={e => setDistance(e.target.value)} onKeyDown={keys} />
          <button className="save-edit" onClick={save}>Save</button>
          <button className="secondary cancel-edit" onClick={() => onEdit(null)}>Cancel</button>
        </div>
      </div>
    );
  }
  return (
    <div className="set-row">
      <span className="set-num">{index + 1}.</span>
      <button className="set-summary-btn" title="Click to edit" onClick={startEdit}>
        {fmtDist(km, distanceUnit)} in {formatDuration(sec)}{" "}
        <span className="rir-tag">{speedText(km, sec, distanceUnit)}</span>
      </button>
      <MoveButtons set={set} index={index} count={count} />
      <button className="danger small" title="Remove" onClick={() => run(() => api.deleteSet(set.id))}>×</button>
    </div>
  );
}
