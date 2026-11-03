import { useState } from "react";
import { api } from "../api";
import { sameName, todayISO } from "../format";
import { useStore } from "../store";
import { Section } from "./common";

export function StartSession() {
  const { run } = useStore();
  const [date, setDate] = useState(todayISO);
  const [names, setNames] = useState<string[]>([]);

  const start = async () => {
    if (!names.length) return;
    const final = names.map((n, i) => n.trim() || `Person ${i + 1}`);
    const dup = final.find((n, i) => final.findIndex(m => sameName(m, n)) !== i);
    if (dup) {
      alert(`${dup} is entered more than once. Each person can only be in a session once.`);
      return;
    }
    const s = await run(() => api.startSession(date, final));
    if (s) {
      setNames([]);
      setDate(todayISO());
    }
  };

  return (
    <Section id="newSession" title="New session">
      <div className="row session">
        <div>
          <label htmlFor="session-date">Date</label>
          <input type="date" id="session-date" value={date} onChange={e => setDate(e.target.value || todayISO())} />
        </div>
      </div>
      <div className="count-row">
        <label>How many people are exercising?</label>
        <div className="count-buttons">
          {[1, 2, 3].map(n => (
            <button
              key={n}
              className={`count-btn${names.length === n ? " active" : ""}`}
              onClick={() => setNames(prev => Array.from({ length: n }, (_, i) => prev[i] || ""))}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
      {names.length > 0 && (
        <div className="names-grid">
          {names.map((v, i) => (
            <div key={i}>
              <label>Person {i + 1}</label>
              <input
                type="text"
                className="name-input"
                value={v}
                placeholder="Name"
                list="known-names"
                autoComplete="off"
                autoFocus={i === 0}
                onChange={e => setNames(prev => prev.map((x, j) => (j === i ? e.target.value : x)))}
                onKeyDown={e => {
                  if (e.key !== "Enter") return;
                  const inputs = document.querySelectorAll<HTMLInputElement>(".name-input");
                  if (i + 1 < inputs.length) inputs[i + 1].focus();
                  else start();
                }}
              />
            </div>
          ))}
        </div>
      )}
      <div className="toolbar" style={{ marginTop: 16 }}>
        <button id="start-btn" disabled={!names.length} onClick={start}>Start session</button>
      </div>
    </Section>
  );
}
