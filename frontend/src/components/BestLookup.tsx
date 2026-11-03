import { useEffect, useState } from "react";
import { api } from "../api";
import { downloadFile, fmtKg1, formatDate, sameName } from "../format";
import { useStore } from "../store";
import type { BestTable, Exercise, Person } from "../types";
import { Caret, num } from "./common";

/** Best weight at each rep count for one person + exercise, with the estimated 1RM and a target. */
export function BestLookup() {
  const { people, exercises, sessions, bestLookup, setBestLookup, isCollapsed, toggleCollapsed } = useStore();
  const collapsed = isCollapsed("bestLookup");
  const person = people.find(p => sameName(p.name, bestLookup.person));
  const exercise = exercises.find(e => e.kind === "strength" && sameName(e.name, bestLookup.exercise));
  const [table, setTable] = useState<BestTable | null>(null);

  useEffect(() => {
    let live = true;
    if (person && exercise) {
      api.bestTable(person.id, exercise.id).then(t => { if (live) setTable(t); }).catch(() => setTable(null));
    } else {
      setTable(null);
    }
    return () => { live = false; };
    // Refetch whenever logged sets change.
  }, [person?.id, exercise?.id, sessions]);

  const hasAny = !!table?.rows.some(r => r.best);
  const downloadCsv = () => {
    if (!table || !person || !exercise) return;
    const lines = ["Reps,Best weight (kg),Date", ...table.rows.map(r => r.best ? `${r.reps},${r.best.weight_kg},${r.best.date}` : `${r.reps},,`)];
    const safe = (s: string) => s.replace(/[^a-z0-9_-]/gi, "_");
    downloadFile(`best_${safe(person.name)}_${safe(exercise.name)}.csv`.toLowerCase(), lines.join("\r\n") + "\r\n", "text/csv;charset=utf-8;");
  };

  return (
    <div className={`card collapsible${collapsed ? " collapsed" : ""}`}>
      <div className="best-header collapsible-head">
        <h2 className="card-collapsible" style={{ margin: 0 }} onClick={() => toggleCollapsed("bestLookup")}>
          <Caret collapsed={collapsed} /> Best lift lookup
        </h2>
        <button className="icon" disabled={!hasAny} title="Download the table as CSV" onClick={downloadCsv}>Download CSV</button>
      </div>
      {!collapsed && (
        <>
          <div className="best-lookup-form">
            <div className="best-person-ex">
              <div>
                <label>Person</label>
                <input type="text" className="best-person" value={bestLookup.person} list="known-names" autoComplete="off" placeholder="Name"
                  onChange={e => setBestLookup({ ...bestLookup, person: e.target.value })} />
              </div>
              <div>
                <label>Exercise</label>
                <input type="text" className="best-exercise" value={bestLookup.exercise} list="known-exercises" autoComplete="off" placeholder="e.g. Bench press"
                  onChange={e => setBestLookup({ ...bestLookup, exercise: e.target.value })} />
              </div>
            </div>
          </div>
          {person && exercise && <TargetRow person={person} exercise={exercise} />}
          <div className="best-result">
            {!bestLookup.person.trim() || !bestLookup.exercise.trim()
              ? <div className="best-empty">Enter a person and an exercise to populate the table.</div>
              : !hasAny
                ? <div className="best-empty">No sets logged for {bestLookup.person} · {bestLookup.exercise}.</div>
                : <BestTableView table={table!} />}
          </div>
        </>
      )}
    </div>
  );
}

function BestTableView({ table }: { table: BestTable }) {
  const est = table.est_1rm;
  const ref1RM = table.rows[0]?.best?.weight_kg ?? null;
  const dash = <span className="muted">—</span>;
  // Reverse Epley: max weight predicted at N reps from the estimated 1RM.
  const predicted = (reps: number) => (reps > 1 && est && est > 0 ? est / (1 + reps / 30) : null);
  return (
    <>
      {est != null && (
        <div className="est-1rm-headline">
          Est. 1RM: <strong>{fmtKg1(est)}</strong>
          <span className="est-1rm-note">Epley, based on your best sets at 2–6 reps</span>
        </div>
      )}
      <table className="best-table">
        <thead>
          <tr>
            <th>Reps</th><th>Best weight</th><th>Date</th>
            <th title="Best weight as a percentage of your actual best single (row 1).">% of 1RM</th>
            <th title="Max weight predicted at this rep count, worked back from your estimated 1RM using the Epley formula.">Est. max</th>
          </tr>
        </thead>
        <tbody>
          {table.rows.map(({ reps, best }) => {
            const pred = predicted(reps);
            const beats = !!best && pred != null && best.weight_kg > pred + 1e-9;
            return (
              <tr key={reps}>
                <td>{reps}</td>
                <td>{best
                  ? <strong className={beats ? "beats-est" : undefined} title={beats ? "Beats the Epley prediction at this rep count" : undefined}>{best.weight_kg} kg</strong>
                  : <span className="muted">—</span>}</td>
                <td className="best-date">{best ? formatDate(best.date) : <span className="muted">—</span>}</td>
                <td className="best-pct">{best && ref1RM ? `${Math.round(best.weight_kg / ref1RM * 100)}%` : dash}</td>
                <td className="best-est">{pred != null ? fmtKg1(pred) : dash}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function TargetRow({ person, exercise }: { person: Person; exercise: Exercise }) {
  const { run, targetFor } = useStore();
  const target = targetFor(person.id, exercise.id);
  const [editing, setEditing] = useState(false);
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("1");

  const startEdit = () => {
    setWeight(target ? String(target.weight_kg) : "");
    setReps(target ? String(target.reps) : "1");
    setEditing(true);
  };
  const save = async () => {
    const w = num(weight);
    const r = num(reps);
    if (!w || w <= 0 || !r || r < 1) return alert("Enter a target weight and rep count.");
    if (await run(() => api.setTarget(person.id, exercise.id, w, Math.round(r)))) setEditing(false);
  };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); save(); }
    if (e.key === "Escape") setEditing(false);
  };

  if (editing) {
    return (
      <div className="target-row editing">
        <span className="target-label">Target</span>
        <input type="number" className="target-weight" min="0" step="0.5" placeholder="kg" value={weight} autoFocus
          onChange={e => setWeight(e.target.value)} onKeyDown={keys} />
        <span className="target-x">kg ×</span>
        <input type="number" className="target-reps" min="1" step="1" placeholder="reps" value={reps}
          onChange={e => setReps(e.target.value)} onKeyDown={keys} />
        <button className="target-save-btn" onClick={save}>Save</button>
        <button className="secondary target-cancel-btn" onClick={() => setEditing(false)}>Cancel</button>
      </div>
    );
  }
  if (!target) {
    return (
      <div className="target-row empty">
        <span className="target-label">Target</span>
        <button className="icon target-set-btn" onClick={startEdit}>Set target</button>
      </div>
    );
  }
  return (
    <div className="target-row">
      <span className="target-label">Target</span>
      <span className={`target-value${target.achieved ? " achieved" : ""}`}>{target.weight_kg} kg × {target.reps}</span>
      {target.achieved
        ? <span className="target-status achieved" title={`Your best at ${target.reps}+ reps (${target.best?.weight_kg} kg) meets the target`}>Achieved</span>
        : <span className="target-status">best {target.best ? `${target.best.weight_kg} kg` : "—"} · {target.pct}%</span>}
      <span className="target-actions">
        <button className="icon target-edit-btn" onClick={startEdit}>Edit</button>
        <button className="danger target-clear-btn" onClick={() => {
          if (confirm(`Clear the target for ${person.name} · ${exercise.name}?`)) run(() => api.deleteTarget(target.id));
        }}>Clear</button>
      </span>
    </div>
  );
}
