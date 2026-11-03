import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { fmt, formatDate, participantVolume, sameName } from "../format";
import { useStore } from "../store";
import type { Participant, Session } from "../types";
import { Caret } from "./common";
import { EntryCard } from "./EntryCard";

export function SessionView({ session, isActive }: { session: Session; isActive: boolean }) {
  const { run, active, isCollapsed, toggleCollapsed, setViewingId } = useStore();
  const collapsed = isCollapsed("session");
  const [editingDate, setEditingDate] = useState(false);
  const [newPerson, setNewPerson] = useState("");

  const addPerson = async () => {
    const name = newPerson.trim() || `Person ${session.participants.length + 1}`;
    const existing = session.participants.find(p => sameName(p.name, name));
    if (existing) {
      alert(`${existing.name} is already in this session.`);
      return;
    }
    if (await run(() => api.addParticipant(session.id, name))) setNewPerson("");
  };

  const resume = async () => {
    if (active && active.id !== session.id
      && !confirm("You already have an active session. Resume this one and send the active one back to history?")) return;
    if (await run(() => api.updateSession(session.id, { status: "active" }))) {
      setViewingId(null);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  return (
    <div className={`card collapsible${collapsed ? " collapsed" : ""}`}>
      <div className="session-header collapsible-head">
        <div className="session-date">
          <Caret collapsed={collapsed} onClick={() => toggleCollapsed("session")} />
          {editingDate ? (
            <input
              type="date"
              className="session-date-input"
              defaultValue={session.date}
              autoFocus
              onBlur={e => {
                const v = e.target.value;
                if (v && v !== session.date) run(() => api.updateSession(session.id, { date: v }));
                setEditingDate(false);
              }}
              onKeyDown={e => { if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur(); }}
            />
          ) : (
            <button className="session-date-btn" title="Click to change the session date" onClick={() => setEditingDate(true)}>
              {formatDate(session.date)}
            </button>
          )}
          {isActive && <> <span style={{ color: "var(--muted)", fontWeight: 400 }}>(active)</span></>}
        </div>
        {isActive ? (
          <button className="icon" id="finish-session" onClick={() => run(() => api.updateSession(session.id, { status: "finished" }))}>
            Finish
          </button>
        ) : (
          <div style={{ display: "flex", gap: 6 }}>
            <button className="icon" id="back-btn" onClick={() => setViewingId(null)}>‹ Back</button>
            <button className="icon" id="resume-session" title="Make this the active session so you can keep logging sets" onClick={resume}>
              Resume
            </button>
          </div>
        )}
      </div>
      {!collapsed && (
        <>
          <div className="workout-grid" style={{ "--cols": session.participants.length } as React.CSSProperties}>
            {session.participants.map(p => (
              <ParticipantColumn key={p.id} session={session} participant={p} isActive={isActive} />
            ))}
          </div>
          {isActive && (
            <div className="add-person-row">
              <input type="text" className="add-person-name" placeholder="Someone joined? Add their name" list="known-names"
                autoComplete="off" value={newPerson} onChange={e => setNewPerson(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") addPerson(); }} />
              <button className="secondary add-person-btn" onClick={addPerson}>+ Add person</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ParticipantColumn({ session, participant, isActive }: {
  session: Session; participant: Participant; isActive: boolean;
}) {
  const { run, people, exercises, isCollapsed, toggleCollapsed } = useStore();
  const key = `p:${participant.id}`;
  const collapsed = isCollapsed(key);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(participant.name);
  const [newEx, setNewEx] = useState("");
  const total = participantVolume(participant);

  // After adding an exercise, jump to its first input once it has rendered.
  const focusNewEntry = useRef(false);
  useEffect(() => {
    if (!focusNewEntry.current) return;
    focusNewEntry.current = false;
    const inputs = document.querySelectorAll<HTMLInputElement>(
      `[data-pid="${participant.id}"] .set-input-reps, [data-pid="${participant.id}"] .cardio-input-duration`);
    inputs[inputs.length - 1]?.focus();
  }, [participant.entries.length, participant.id]);

  const saveName = async () => {
    const n = name.trim();
    if (!n || n === participant.name) return setRenaming(false);
    const clash = session.participants.find(p => p.id !== participant.id && sameName(p.name, n));
    if (clash) {
      alert(`${clash.name} is already in this session.`);
      return;
    }
    const other = people.find(p => p.id !== participant.person_id && sameName(p.name, n));
    if (other) {
      // The name belongs to someone else: this column was them all along.
      if (!confirm(`${other.name} already exists. Log this session's workout as ${other.name}'s?\n\n`
        + `(To combine every session of ${participant.name} with ${other.name}, use Merge in the People section.)`)) return;
      await run(() => api.reassignParticipant(participant.id, other.name));
    } else {
      await run(() => api.renamePerson(participant.person_id, n));
    }
    setRenaming(false);
  };

  const addExercise = async () => {
    const n = newEx.trim();
    if (!n) return;
    focusNewEntry.current = true;
    if (await run(() => api.addEntry(participant.id, { name: n }))) setNewEx("");
  };
  const addCardio = async () => {
    const first = exercises.find(e => e.kind === "cardio");
    if (!first) return alert("No cardio activities yet — add one in the Exercises section.");
    focusNewEntry.current = true;
    await run(() => api.addEntry(participant.id, { exercise_id: first.id }));
  };
  const removeParticipant = () => {
    const sets = participant.entries.reduce((n, e) => n + e.sets.length, 0);
    const what = participant.entries.length
      ? `, with ${participant.entries.length} exercise(s) and ${sets} set(s)? These can't be recovered.`
      : "?";
    if (!confirm(`Remove ${participant.name} from the session on ${formatDate(session.date)}${what}`)) return;
    run(() => api.removeParticipant(participant.id));
  };

  return (
    <div className={`participant-col collapsible${collapsed ? " collapsed" : ""}`} data-pid={participant.id}>
      <div className="participant-header collapsible-head">
        <Caret collapsed={collapsed} onClick={() => toggleCollapsed(key)} />
        {renaming ? (
          <div className="participant-rename-form">
            <input type="text" className="participant-rename-input" value={name} list="known-names" autoComplete="off" autoFocus
              onFocus={e => e.target.select()} onChange={e => setName(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") { e.preventDefault(); saveName(); }
                if (e.key === "Escape") setRenaming(false);
              }} />
            <button className="participant-rename-save" onClick={saveName}>Save</button>
            <button className="secondary participant-rename-cancel" onClick={() => setRenaming(false)}>Cancel</button>
          </div>
        ) : (
          <button className="participant-name-btn" title="Click to rename — updates this name in every session"
            onClick={() => { setName(participant.name); setRenaming(true); }}>
            {participant.name}
          </button>
        )}
        {total > 0 && <div className="participant-total" title="Sum of reps × weight across all sets">Total: {fmt(total)} kg</div>}
        {session.participants.length > 1 && (
          <button className="danger small participant-remove" title="Remove this person from the session" onClick={removeParticipant}>×</button>
        )}
      </div>
      {!collapsed && (
        <>
          <div className="exercises-list">
            {participant.entries.length === 0
              ? <div className="empty small">No exercises{isActive ? " yet" : ""}.</div>
              : participant.entries.map(e => <EntryCard key={e.id} participant={participant} entry={e} isActive={isActive} />)}
          </div>
          {isActive && (
            <div className="add-exercise">
              <label>Add exercise</label>
              <div className="add-exercise-row">
                <input type="text" className="new-ex-name" placeholder="e.g. Bench press" list="known-exercises" autoComplete="off"
                  value={newEx} onChange={e => setNewEx(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addExercise(); }} />
                <button className="add-ex-btn" onClick={addExercise}>Add</button>
              </div>
              <div className="add-cardio-row">
                <button className="secondary add-cardio-btn" title="Log cardio (run, walk, …): duration and distance" onClick={addCardio}>
                  + Cardio
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
