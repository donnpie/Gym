import { useState } from "react";
import { api } from "../api";
import { EQUIPMENT_LABELS, fmtDist, formatDate } from "../format";
import { useStore } from "../store";
import type { ExerciseSummary, Person } from "../types";
import { Section } from "./common";

/** Rename / merge / delete controls shared by the Exercises and People lists. */
function ManageMenu<T extends { id: number; name: string }>({ item, all, noun, used, onRename, onMerge, onDelete, onClose }: {
  item: T; all: T[]; noun: string; used: boolean;
  onRename: (name: string) => Promise<unknown>;
  onMerge: (intoId: number) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
  onClose: () => void;
}) {
  const { run } = useStore();
  const [name, setName] = useState(item.name);
  const [into, setInto] = useState("");
  const others = all.filter(x => x.id !== item.id);
  const rename = async () => {
    if (name.trim() && name.trim() !== item.name && await run(() => onRename(name.trim()))) onClose();
  };
  return (
    <div className="manage-panel">
      <div className="manage-row">
        <input type="text" value={name} autoFocus onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") rename(); if (e.key === "Escape") onClose(); }} />
        <button onClick={rename}>Rename</button>
      </div>
      {others.length > 0 && (
        <div className="manage-row">
          <select value={into} onChange={e => setInto(e.target.value)}>
            <option value="">Merge into…</option>
            {others.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <button className="secondary" disabled={!into} onClick={async () => {
            const target = others.find(o => o.id === Number(into))!;
            if (!confirm(`Merge ${item.name} into ${target.name}? Every session logged as ${item.name} becomes ${target.name}. This can't be undone.`)) return;
            if (await run(() => onMerge(target.id))) onClose();
          }}>Merge</button>
        </div>
      )}
      <div className="manage-row">
        {!used && <button className="danger" onClick={async () => {
          if (!confirm(`Delete ${item.name}?`)) return;
          await run(onDelete);
          onClose();
        }}>Delete {noun}</button>}
        <button className="secondary" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

export function ExerciseList() {
  const { summary, exercises, run, distanceUnit, setHistoryFilter, setCollapsed } = useStore();
  const [search, setSearch] = useState("");
  const [managing, setManaging] = useState<number | null>(null);
  const [newCardio, setNewCardio] = useState("");
  const term = search.trim().toLowerCase();
  const shown = summary.filter(e => !term || e.name.toLowerCase().includes(term));

  const typeLabel = (e: ExerciseSummary) => e.kind === "cardio" ? "Cardio" : EQUIPMENT_LABELS[e.equipment_type] || e.equipment_type;
  const best = (e: ExerciseSummary) => {
    const parts = e.bests.map(b => b.distance_km ? `${b.person} ${fmtDist(b.distance_km, distanceUnit)}`
      : b.weight_kg ? `${b.person} ${b.weight_kg} kg` : null).filter(Boolean);
    return parts.length ? parts.map((p, i) => <div key={i}>{p}</div>) : <span className="muted-tag">—</span>;
  };
  const showInHistory = (name: string) => {
    setHistoryFilter({ person: "", exercise: name });
    setCollapsed("history", false);
    requestAnimationFrame(() => document.getElementById("history-section")?.scrollIntoView({ behavior: "smooth" }));
  };

  return (
    <Section id="exerciseList" title={<>Exercises <span className="muted-tag">· {summary.length}</span></>}>
      <input type="search" className="exercise-search" placeholder="Search exercises…" value={search}
        autoComplete="off" onChange={e => setSearch(e.target.value)} />
      <div className="exercise-list-head">
        <span>Exercise</span><span>Type</span><span>Done</span><span>Last</span><span>Best</span><span />
      </div>
      <div className="exercise-list-rows">
        {shown.length === 0 && <div className="empty small">No exercises match “{search}”.</div>}
        {shown.map(e => (
          <div key={e.id}>
            <div className="exercise-list-row">
              <button className="exercise-list-name" title={e.times ? "Show this exercise in History" : "Not logged yet"}
                disabled={!e.times} onClick={() => showInHistory(e.name)}>{e.name}</button>
              <span className="exercise-list-type">{typeLabel(e)}</span>
              <span title="Times logged">{e.times}×</span>
              <span>{e.last_date ? formatDate(e.last_date) : ""}</span>
              <span className="exercise-list-best">{best(e)}</span>
              <button className="icon small manage-btn" title="Rename, merge or delete"
                onClick={() => setManaging(managing === e.id ? null : e.id)}>⋯</button>
            </div>
            {managing === e.id && (
              <ManageMenu item={e} all={exercises.filter(x => x.kind === e.kind)} noun="exercise" used={e.times > 0}
                onRename={n => api.renameExercise(e.id, n)} onMerge={id => api.mergeExercise(e.id, id)}
                onDelete={() => api.deleteExercise(e.id)} onClose={() => setManaging(null)} />
            )}
          </div>
        ))}
      </div>
      <div className="add-person-row">
        <input type="text" placeholder="New cardio activity, e.g. Cycle or Swim" value={newCardio}
          onChange={e => setNewCardio(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") document.getElementById("add-cardio-activity")?.click(); }} />
        <button id="add-cardio-activity" className="secondary" onClick={async () => {
          if (newCardio.trim() && await run(() => api.createExercise(newCardio.trim(), "cardio"))) setNewCardio("");
        }}>+ Cardio activity</button>
      </div>
    </Section>
  );
}

export function PeopleList() {
  const { people, sessions } = useStore();
  const [managing, setManaging] = useState<number | null>(null);
  const stats = (p: Person) => {
    const mine = sessions.filter(s => s.participants.some(x => x.person_id === p.id));
    return { count: mine.length, last: mine[0]?.date };  // sessions are newest first
  };
  return (
    <Section id="people" title={<>People <span className="muted-tag">· {people.length}</span></>}>
      {people.length === 0 && <div className="empty small">Nobody yet — start a session.</div>}
      <div className="people-rows">
        {people.map(p => {
          const st = stats(p);
          return (
            <div key={p.id}>
              <div className="people-row">
                <span className="people-name">{p.name}</span>
                <span>{st.count} session{st.count === 1 ? "" : "s"}</span>
                <span>{st.last ? `Last: ${formatDate(st.last)}` : ""}</span>
                <button className="icon small manage-btn" title="Rename, merge or delete"
                  onClick={() => setManaging(managing === p.id ? null : p.id)}>⋯</button>
              </div>
              {managing === p.id && (
                <ManageMenu item={p} all={people} noun="person" used={st.count > 0}
                  onRename={n => api.renamePerson(p.id, n)} onMerge={id => api.mergePerson(p.id, id)}
                  onDelete={() => api.deletePerson(p.id)} onClose={() => setManaging(null)} />
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}
