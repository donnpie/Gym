import { useState } from "react";
import { useStore } from "../store";
import { Section } from "./common";
import { PRCalc } from "./widgets";

export function TargetsOverview() {
  const { targets, setBestLookup, setCollapsed } = useStore();
  const open = (person: string, exercise: string) => {
    setBestLookup({ person, exercise });
    setCollapsed("bestLookup", false);
    requestAnimationFrame(() => document.getElementById("best-lookup")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  return (
    <Section id="targetsOverview" title="Targets">
      <div className="target-ov-list">
        {targets.length === 0 ? (
          <div className="empty small">No targets yet — set one in the Best lift lookup.</div>
        ) : (
          <>
            <div className="target-ov-head">
              <span>Lift</span>
              <span>Target</span>
              <span title="Estimated 1RM (Epley, from best sets at 2–6 reps)">Est. 1RM</span>
              <span title="Actual 1RM (heaviest single logged)">Actual 1RM</span>
              <span>Progress to target</span>
            </div>
            {targets.map(t => (
              <button key={t.id} className="target-ov-row" title="Open in Best lift lookup" onClick={() => open(t.person, t.exercise)}>
                <span className="target-ov-name">{t.person} · {t.exercise}</span>
                <span className="target-ov-goal"><span className="target-ov-mlabel">Target </span>{t.weight_kg} kg × {t.reps}</span>
                <span className="target-ov-est" title="Estimated 1RM (Epley, from best sets at 2–6 reps)">
                  <span className="target-ov-mlabel">Est. 1RM </span>{t.est_1rm != null ? `${(Math.round(t.est_1rm * 10) / 10).toFixed(1)} kg` : "—"}
                </span>
                <span className="target-ov-est" title="Actual 1RM (heaviest single logged)">
                  <span className="target-ov-mlabel">Actual 1RM </span>{t.actual_1rm != null ? `${t.actual_1rm} kg` : "—"}
                </span>
                <span className="target-ov-progress">
                  <span className="target-ov-bar">
                    <span className={`target-ov-fill${t.achieved ? " achieved" : ""}`} style={{ width: `${Math.min(100, t.pct)}%` }} />
                  </span>
                  <span className={`target-ov-pct${t.achieved ? " achieved" : ""}`}>{t.achieved ? "Achieved" : `${t.pct}%`}</span>
                </span>
              </button>
            ))}
          </>
        )}
      </div>
    </Section>
  );
}

export function PRHelper() {
  const { prs } = useStore();
  const [weight, setWeight] = useState("");
  const w = Number(weight);
  return (
    <Section id="prHelper" title="PR helper">
      <div>
        <label htmlFor="helper-weight">Calculate percentages of</label>
        <input type="number" id="helper-weight" min="0" step="0.5" value={weight} placeholder="Enter a weight (kg)"
          onChange={e => setWeight(e.target.value)} />
      </div>
      {prs.length > 0 && (
        <div className="quick-picks">
          <div className="quick-picks-label">Or pick a known PR</div>
          <div className="quick-picks-row">
            {prs.map(p => (
              <button key={`${p.person_id}:${p.exercise_id}`} className="quick-pick" onClick={() => setWeight(String(p.weight_kg))}>
                <span className="quick-pick-name">{p.person} · {p.exercise}</span>
                <span className="quick-pick-wt">{p.weight_kg} kg</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="helper-calc-root">{w > 0 && <PRCalc weight={w} />}</div>
    </Section>
  );
}
