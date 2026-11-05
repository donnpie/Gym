import type { KeyboardEvent } from "react";
import { bandLabel, calcPlates, smallestIncrement } from "../format";
import { useStore } from "../store";

/** Reps you should manage at a weight, given a 1-rep max: Epley (1RM = w × (1 + reps/30)) solved for reps. */
export function epleyReps(oneRm: number, weight: number): number {
  return Math.max(1, Math.floor(30 * (oneRm / weight - 1) + 1e-9));
}

/** Working weights at 50–100% of a weight, rounded to what the plates can load.
 *  With showReps, also the reps each should allow, treating the weight as a 1-rep max. */
export function PRCalc({ weight, showReps = false }: { weight: number; showReps?: boolean }) {
  const { inventory } = useStore();
  const step = smallestIncrement(inventory);
  const pcts = [50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100];
  const round = (w: number) => Math.round((Math.round(w / step) * step) * 100) / 100;
  const half = Math.ceil(pcts.length / 2);
  const left = pcts.slice(0, half);
  const right = pcts.slice(half);
  const cell = (p: number | undefined, k: string) => {
    if (p == null) return [<span key={`${k}p`} />, <span key={`${k}w`} />, ...(showReps ? [<span key={`${k}r`} />] : [])];
    const w = round(weight * p / 100);
    return [
      <span key={`${k}p`} className="pct">{p}%</span>,
      <span key={`${k}w`} className="wt">{w} kg</span>,
      ...(showReps ? [<span key={`${k}r`} className="reps">×{w > 0 ? epleyReps(weight, w) : "–"}</span>] : []),
    ];
  };
  return (
    <div className="pr-calc">
      <div className="pr-calc-header">
        PR {weight} kg · {step} kg increments{showReps && <> · reps by Epley, taking {weight} kg as your 1-rep max</>}
      </div>
      <div className={`pr-calc-grid${showReps ? " with-reps" : ""}`}>
        {left.map((p, i) => [...cell(p, `l${i}`), ...cell(right[i], `r${i}`)])}
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
