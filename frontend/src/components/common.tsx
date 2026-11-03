import type { ReactNode } from "react";
import { useStore } from "../store";

export function Caret({ collapsed, onClick }: { collapsed: boolean; onClick?: () => void }) {
  return (
    <span
      className="collapse-caret"
      title={onClick ? "Collapse / expand" : undefined}
      style={onClick ? { cursor: "pointer" } : undefined}
      onClick={onClick ? e => { e.stopPropagation(); onClick(); } : undefined}
    >
      {collapsed ? "▸" : "▾"}
    </span>
  );
}

/** A top-level section card whose heading collapses it. */
export function Section({ id, title, extra, children }: {
  id: string; title: ReactNode; extra?: ReactNode; children: ReactNode;
}) {
  const { isCollapsed, toggleCollapsed } = useStore();
  const collapsed = isCollapsed(id);
  return (
    <div className={`card collapsible${collapsed ? " collapsed" : ""}`}>
      <h2 className="card-collapsible collapsible-head" onClick={() => toggleCollapsed(id)}>
        <Caret collapsed={collapsed} /> {title}
        {extra && <span className="section-extra" onClick={e => e.stopPropagation()}>{extra}</span>}
      </h2>
      {!collapsed && children}
    </div>
  );
}

/** A collapsible sub-heading inside a section (e.g. Plates within Plates & bars). */
export function SubSection({ id, title, className, children }: {
  id: string; title: ReactNode; className?: string; children: ReactNode;
}) {
  const { isCollapsed, toggleCollapsed } = useStore();
  const collapsed = isCollapsed(id);
  return (
    <div className={`${className || ""} collapsible${collapsed ? " collapsed" : ""}`}>
      <label className="card-collapsible collapsible-head" onClick={() => toggleCollapsed(id)}>
        <Caret collapsed={collapsed} /> {title}
      </label>
      {!collapsed && children}
    </div>
  );
}

/** Suggestions for name inputs, shared by every form that types a person or exercise. */
export function Datalists() {
  const { people, exercises } = useStore();
  return (
    <>
      <datalist id="known-names">{people.map(p => <option key={p.id} value={p.name} />)}</datalist>
      <datalist id="known-exercises">
        {exercises.filter(e => e.kind === "strength").map(e => <option key={e.id} value={e.name} />)}
      </datalist>
    </>
  );
}

export function UnitToggle() {
  const { distanceUnit, setDistanceUnit } = useStore();
  return (
    <span className="unit-toggle" title="Show distances in kilometres or miles">
      {(["km", "mi"] as const).map(u => (
        <button key={u} className={`unit-btn${distanceUnit === u ? " active" : ""}`} onClick={() => setDistanceUnit(u)}>
          {u}
        </button>
      ))}
    </span>
  );
}

/** Number input value -> number | null. */
export const num = (v: string) => (v.trim() === "" || isNaN(Number(v)) ? null : Number(v));
