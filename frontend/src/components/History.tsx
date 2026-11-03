import { useRef } from "react";
import { api } from "../api";
import {
  cardioSummary, cardioTotals, downloadFile, entryVolume, fmt, formatDate, participantVolume, sameName,
} from "../format";
import { useStore } from "../store";
import type { Participant } from "../types";
import { Caret, Section } from "./common";

export function DataTools() {
  const { sessions, run } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const setCount = sessions.reduce((n, s) => n + s.participants.reduce(
    (m, p) => m + p.entries.reduce((k, e) => k + e.sets.length, 0), 0), 0);

  const exportAll = async () => {
    const data = await api.exportAll();
    downloadFile(`gym-tracker-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2),
      "application/json;charset=utf-8;");
  };

  const importFile = async (file: File) => {
    let data: unknown;
    try {
      data = JSON.parse(await file.text());
    } catch {
      return alert("That file isn't valid JSON.");
    }
    const incoming = Array.isArray(data) ? data : (data as { sessions?: unknown[] })?.sessions;
    if (!Array.isArray(incoming)) return alert("No sessions found in that file. Expected an export from this app.");
    let mode: "replace" | "merge" = "merge";
    if (sessions.length) {
      mode = confirm(
        `Import ${incoming.length} session(s).\n\n`
        + `OK = replace all current data (${sessions.length} session(s)).\n`
        + "Cancel = merge into current data (sessions already imported from this file are updated).",
      ) ? "replace" : "merge";
    }
    const res = await run(() => api.importAll(data, mode));
    if (res) {
      alert(`Imported ${res.sessions} session(s).${res.warnings.length ? `\n\nNotes:\n• ${res.warnings.join("\n• ")}` : ""}`);
    }
  };

  return (
    <Section id="dataTools" title="Data">
      <p className="data-tools-note">
        Your data lives in the local SQLite database (backend/gym.db). Export to a JSON file to back it up or feed it
        into another tool (Power BI, a script, etc.), or import an export — including one from the old browser-only
        version of this app — to restore it.
      </p>
      <div className="data-tools-row">
        <button onClick={exportAll}>Export all data (JSON)</button>
        <button onClick={() => fileRef.current?.click()}>Import data (JSON)</button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden
          onChange={e => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) importFile(f);
          }} />
        <span className="data-tools-stats">
          {sessions.length} session{sessions.length === 1 ? "" : "s"} · {setCount} set{setCount === 1 ? "" : "s"}
        </span>
      </div>
    </Section>
  );
}

export function History() {
  const {
    sessions, run, historyFilter: f, setHistoryFilter, setViewingId, isCollapsed, toggleCollapsed, distanceUnit, prFor,
  } = useStore();
  const past = sessions.filter(s => s.status !== "active");

  const uniqueSorted = (names: string[]) => {
    const seen = new Map<string, string>();
    names.forEach(n => { if (n.trim() && !seen.has(n.toLowerCase())) seen.set(n.toLowerCase(), n); });
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  };
  const allParticipants = past.flatMap(s => s.participants);
  const personNames = uniqueSorted(allParticipants.map(p => p.name));
  const exerciseNames = uniqueSorted(allParticipants
    .filter(p => !f.person || sameName(p.name, f.person))
    .flatMap(p => p.entries.map(e => e.name)));
  // Keep a chosen value selectable even if it no longer appears in the list.
  if (f.person && !personNames.some(n => sameName(n, f.person))) personNames.unshift(f.person);
  if (f.exercise && !exerciseNames.some(n => sameName(n, f.exercise))) exerciseNames.unshift(f.exercise);

  // Narrow each session to the chosen person/exercise; drop sessions with nothing left.
  const shown = past.map(session => ({
    session,
    participants: session.participants
      .filter(p => !f.person || sameName(p.name, f.person))
      .map(p => ({ ...p, entries: p.entries.filter(e => !f.exercise || sameName(e.name, f.exercise)) }))
      .filter(p => !f.exercise || p.entries.length > 0),
  })).filter(x => x.participants.length > 0);

  const open = (id: number) => {
    setViewingId(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <section id="history-section">
      <Section id="history" title="History">
        {past.length > 0 && (
          <div className="history-filters">
            <div>
              <label>Person</label>
              <select className="history-filter-person" value={personNames.find(n => sameName(n, f.person)) || ""}
                onChange={e => setHistoryFilter({ ...f, person: e.target.value })}>
                <option value="">All people</option>
                {personNames.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <label>Exercise</label>
              <select className="history-filter-exercise" value={exerciseNames.find(n => sameName(n, f.exercise)) || ""}
                onChange={e => setHistoryFilter({ ...f, exercise: e.target.value })}>
                <option value="">All exercises</option>
                {exerciseNames.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            {(f.person || f.exercise) && (
              <button className="secondary history-filter-clear" onClick={() => setHistoryFilter({ person: "", exercise: "" })}>Clear</button>
            )}
          </div>
        )}
        <div id="history">
          {past.length === 0 ? <div className="empty">No past sessions yet.</div>
            : shown.length === 0 ? <div className="empty">No sessions match these filters.</div>
              : shown.map(({ session, participants }) => {
                const key = `h:${session.id}`;
                const collapsed = isCollapsed(key);
                const total = participants.reduce((sum, p) => sum + participantVolume(p), 0);
                return (
                  <div key={session.id} className={`card collapsible${collapsed ? " collapsed" : ""}`}>
                    <div className="session-header collapsible-head">
                      <div className="session-date">
                        <Caret collapsed={collapsed} onClick={() => toggleCollapsed(key)} />
                        {formatDate(session.date)}{" "}
                        <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                          · {participants.length} {participants.length === 1 ? "person" : "people"}
                        </span>
                        {total > 0 && <span className="muted-tag"> · {fmt(total)} kg total</span>}
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button className="icon" onClick={() => open(session.id)}>Open</button>
                        <button className="danger" onClick={() => {
                          if (confirm("Delete this session?")) run(() => api.deleteSession(session.id));
                        }}>Delete</button>
                      </div>
                    </div>
                    {!collapsed && participants.map(p => (
                      <HistoryParticipant key={p.id} participant={p} distanceUnit={distanceUnit} prFor={prFor} />
                    ))}
                  </div>
                );
              })}
        </div>
      </Section>
    </section>
  );
}

function HistoryParticipant({ participant: p, distanceUnit, prFor }: {
  participant: Participant;
  distanceUnit: "km" | "mi";
  prFor: ReturnType<typeof useStore>["prFor"];
}) {
  const total = participantVolume(p);
  return (
    <div className="history-participant">
      <div className="history-name">{p.name}{total > 0 && <span className="muted-tag"> · {fmt(total)} kg total</span>}</div>
      {p.entries.length === 0 ? <div className="empty small" style={{ textAlign: "left" }}>No exercises.</div>
        : p.entries.map(e => {
          const pr = e.kind === "cardio" ? undefined : prFor(p.person_id, e.exercise_id);
          const volume = entryVolume(e);
          return (
            <div key={e.id} className="history-exercise compact">
              <span className="exercise-title">
                {e.name}{pr && <> <span className="pr-tag" title="Personal record — heaviest weight lifted">(PR: {pr.weight_kg} kg)</span></>}
              </span>
              <span className="muted-tag">
                {e.kind === "cardio"
                  ? (t => cardioSummary(t.distanceKm, t.durationSec, distanceUnit))(cardioTotals(e))
                  : volume > 0 ? `${fmt(volume)} kg` : `${e.sets.length} set${e.sets.length === 1 ? "" : "s"}`}
              </span>
            </div>
          );
        })}
    </div>
  );
}
