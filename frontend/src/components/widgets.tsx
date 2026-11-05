import type { KeyboardEvent } from "react";
import { bandLabel, calcPlates, smallestIncrement } from "../format";
import { useStore } from "../store";

/** Reps you should manage at a weight, given a 1-rep max: Epley (1RM = w × (1 + reps/30)) solved for reps.
 *  At the 1RM itself the formula gives 0, so it never goes below 1. */
export function epleyReps(oneRm: number, weight: number): number {
  return Math.max(1, 30 * (oneRm / weight - 1));
}

type CalcRow = { pct: number; kg: number; reps: number; exact: boolean };

/** Working weights at 50–100% of a weight, rounded to what the plates can load.
 *  With showReps, also the reps each should allow, treating the weight as a 1-rep max, plus the exact
 *  weights (unrounded) for whole numbers of reps from 2 to 16, slotted in between. */
export function PRCalc({ weight, showReps = false }: { weight: number; showReps?: boolean }) {
  const { inventory } = useStore();
  const step = smallestIncrement(inventory);
  const round = (w: number) => Math.round((Math.round(w / step) * step) * 100) / 100;
  const rows: CalcRow[] = [50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100].map(pct => {
    const kg = round(weight * pct / 100);
    return { pct, kg, reps: kg > 0 ? epleyReps(weight, kg) : 0, exact: false };
  });
  if (showReps) {
    for (let reps = 2; reps <= 16; reps++) {
      const pct = 100 * 30 / (30 + reps);
      rows.push({ pct, kg: Math.round(weight * pct) / 100, reps, exact: true });
    }
    rows.sort((a, b) => a.pct - b.pct || Number(a.exact) - Number(b.exact));
  }
  const half = Math.ceil(rows.length / 2);
  const left = rows.slice(0, half);
  const right = rows.slice(half);
  const cell = (r: CalcRow | undefined, k: string) => {
    if (!r) return [<span key={`${k}p`} />, <span key={`${k}w`} />, ...(showReps ? [<span key={`${k}r`} />] : [])];
    const cls = r.exact ? " exact" : "";
    return [
      <span key={`${k}p`} className={`pct${cls}`}>{r.exact ? r.pct.toFixed(1) : r.pct}%</span>,
      <span key={`${k}w`} className={`wt${cls}`}>{r.exact ? r.kg.toFixed(1) : r.kg} kg</span>,
      ...(showReps ? [<span key={`${k}r`} className={`reps${cls}`}>×{r.kg > 0 ? r.reps.toFixed(1) : "–"}</span>] : []),
    ];
  };
  return (
    <div className="pr-calc">
      <div className="pr-calc-header">
        PR {weight} kg · {step} kg increments
        {showReps && <> · reps by Epley, taking {weight} kg as your 1-rep max · <span className="exact">exact weights for 2–16 reps</span></>}
      </div>
      <div className={`pr-calc-grid${showReps ? " with-reps" : ""}`}>
        {left.map((r, i) => [...cell(r, `l${i}`), ...cell(right[i], `r${i}`)])}
      </div>
    </div>
  );
}

/** Plates per side for a barbell weight, or with barKg null, the plates that make up the weight. */
export function PlatesHint({ weight, barKg }: { weight: number | null; barKg: number | null }) {
  const { inventory } = useStore();
  if (weight == null || !(weight > 0)) {
    return <div className="plates-hint warning">Enter a weight to see plate breakdown</div>;
  }
  const r = calcPlates(weight, barKg, inventory);
  if (!r) return null;
  if (r.type === "below_bar") return <div className="plates-hint warning">Below bar weight ({r.bar} kg)</div>;
  if (!r.plates.length) return <div className="plates-hint">Empty bar ({r.bar} kg)</div>;
  const grouped = new Map<number, number>();
  r.plates.forEach(kg => grouped.set(kg, (grouped.get(kg) || 0) + 1));
  return (
    <div className="plates-hint">
      <span className="plates-label">{barKg == null ? "Plates" : "Per side"}</span>
      <span className="plates-badges">
        {[...grouped.entries()].map(([kg, ct]) => (
          <span key={kg} className="plate-badge">{kg}{ct > 1 && <span className="plate-ct">×{ct}</span>}</span>
        ))}
      </span>
      {r.type === "partial" && (
        <span className="plates-leftover">closest: {r.achieved} kg (short {r.leftover} kg{barKg == null ? "" : "/side"})</span>
      )}
    </div>
  );
}

/** The band, plus an optional second band for exercises that combine two. */
export function BandPicker({ value, onChange, onEnter }: {
  value: number[]; onChange: (ids: number[]) => void; onEnter?: () => void;
}) {
  const { inventory } = useStore();
  const bands = inventory.bands;
  const options = bands.map(b => (
    <option key={b.id} value={b.id}>{bandLabel(b)}{b.strength ? ` (${b.strength})` : ""}</option>
  ));
  const set = (i: number, v: string) => {
    const next = [...value];
    next[i] = Number(v);
    onChange(next.filter((x, j) => x && (j === 0 || next[0])));
  };
  const keys = onEnter ? { onKeyDown: (e: KeyboardEvent) => { if (e.key === "Enter") onEnter(); } } : {};
  return (
    <div className="band-picker">
      <select className="set-input-band" title="Which band you used" value={value[0] ?? ""} onChange={e => set(0, e.target.value)} {...keys}>
        {bands.length ? options : <option value="">No bands — add them under Plates &amp; bars</option>}
      </select>
      <select className="set-input-band" title="Second band, if you used two" value={value[1] ?? ""} onChange={e => set(1, e.target.value)} {...keys}>
        <option value="">+ 2nd band: none</option>
        {options}
      </select>
    </div>
  );
}
