import { api } from "../api";
import { useStore } from "../store";
import type { InventoryList } from "../types";
import { Section, SubSection } from "./common";

interface Field {
  key: string;
  type: "text" | "number";
  placeholder?: string;
  step?: string;
  list?: string;
}

type Row = { id: number } & Record<string, string | number>;

/** One editable inventory row. Saves when a field loses focus (or on Enter). */
function InvRow({ list, row, fields, className, extra }: {
  list: InventoryList; row: Row; fields: Field[]; className: string; extra?: React.ReactNode;
}) {
  const { run } = useStore();
  const save = (form: HTMLElement) => {
    const body: Record<string, string | number> = {};
    let changed = false;
    fields.forEach(f => {
      const input = form.querySelector<HTMLInputElement>(`[data-field="${f.key}"]`)!;
      const v = f.type === "number" ? (f.key === "count" ? parseInt(input.value, 10) || 0 : parseFloat(input.value) || 0) : input.value;
      body[f.key] = v;
      if (v !== row[f.key]) changed = true;
    });
    if (changed) run(() => api.updateInventory(list, row.id, body));
  };
  return (
    // key on values so the inputs refresh after a save from elsewhere
    <div className={className} key={JSON.stringify(row)}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) save(e.currentTarget); }}
      onKeyDown={e => { if (e.key === "Enter") save(e.currentTarget); }}>
      {fields.map(f => (
        <input key={f.key} data-field={f.key} type={f.type} defaultValue={row[f.key]} placeholder={f.placeholder}
          step={f.step} min={f.type === "number" ? 0 : undefined} list={f.list} />
      ))}
      {extra}
      <button className="danger small" title="Remove" onClick={() => run(() => api.removeInventory(list, row.id))}>×</button>
    </div>
  );
}

const pairsLabel = (count: number) => {
  const pairs = Math.floor((count || 0) / 2);
  return pairs === 0 ? "—" : pairs === 1 ? "1 pair" : `${pairs} pairs`;
};

export function InventoryEditor() {
  const { inventory: inv, run } = useStore();
  const add = (list: InventoryList, body: object) => run(() => api.addInventory(list, body));
  const bandTypes = [...new Set(inv.bands.map(b => b.type.trim()).filter(Boolean))];
  const kgCount: Field[] = [{ key: "kg", type: "number", step: "0.5" }, { key: "count", type: "number", step: "1" }];

  const gear = (list: "dumbbells" | "kettlebells", label: string, addLabel: string) => (
    <SubSection id={`inv-${list}`} className="inv-gear" title={label}>
      <div className="inv-gear-header"><span>Weight (kg)</span><span>Count</span><span /></div>
      <div className="inv-gear-rows">
        {inv[list].map(g => <InvRow key={g.id} list={list} row={g as unknown as Row} fields={kgCount} className="inv-gear-row" />)}
      </div>
      <button className="inv-add" onClick={() => add(list, { kg: 0, count: list === "dumbbells" ? 2 : 1 })}>{addLabel}</button>
    </SubSection>
  );

  return (
    <Section id="plateEditor" title="Plates & bars">
      <SubSection id="inv-bars" className="inv-bars" title="Bars (first bar is the default)">
        <div className="inv-bars-header"><span>Name</span><span>Weight (kg)</span><span /></div>
        <div className="inv-bars-rows">
          {inv.bars.map(b => (
            <InvRow key={b.id} list="bars" row={b as unknown as Row} className="inv-bar-row-item"
              fields={[{ key: "name", type: "text", placeholder: "Name" }, { key: "kg", type: "number", step: "0.5" }]} />
          ))}
        </div>
        <button className="inv-add-bar" onClick={() => add("bars", { name: "", kg: 0 })}>+ Add bar</button>
      </SubSection>
      <SubSection id="inv-plates" className="inv-plates" title="Plates (weight × total plates owned)">
        <div className="inv-rows-header"><span>Weight (kg)</span><span>Plates</span><span>Loadable</span><span /></div>
        <div className="inv-rows">
          {inv.plates.map(p => (
            <InvRow key={p.id} list="plates" row={p as unknown as Row} className="inv-row"
              fields={[{ key: "kg", type: "number", step: "0.25" }, { key: "count", type: "number", step: "1" }]}
              extra={<span className="inv-pairs">{pairsLabel(p.count)}</span>} />
          ))}
        </div>
        <button className="inv-add" onClick={() => add("plates", { kg: 0, count: 0 })}>+ Add plate size</button>
      </SubSection>
      {gear("dumbbells", "Dumbbells (weight × dumbbells owned)", "+ Add dumbbell size")}
      {gear("kettlebells", "Kettlebells (weight × kettlebells owned)", "+ Add kettlebell size")}
      <SubSection id="inv-accessories" className="inv-acc" title="Accessories (attachments needed for certain exercises)">
        <div className="inv-bars-header"><span>Name</span><span>Count</span><span /></div>
        <div className="inv-acc-rows">
          {inv.accessories.map(a => (
            <InvRow key={a.id} list="accessories" row={a as unknown as Row} className="inv-acc-row"
              fields={[{ key: "name", type: "text", placeholder: "e.g. Landmine attachment" }, { key: "count", type: "number", step: "1" }]} />
          ))}
        </div>
        <button className="inv-add" onClick={() => add("accessories", { name: "", count: 1 })}>+ Add accessory</button>
      </SubSection>
      <SubSection id="inv-bands" className="inv-bands" title="Resistance bands (lightest to heaviest within each type)">
        <div className="inv-bands-header"><span>Type</span><span>Colour</span><span>Strength</span><span>Count</span><span /></div>
        <div className="inv-band-rows">
          {inv.bands.map(b => (
            <InvRow key={b.id} list="bands" row={b as unknown as Row} className="inv-band-row"
              fields={[
                { key: "type", type: "text", placeholder: "e.g. Power band", list: "band-types" },
                { key: "colour", type: "text", placeholder: "Colour" },
                { key: "strength", type: "text", placeholder: "e.g. Light" },
                { key: "count", type: "number", step: "1" },
              ]} />
          ))}
        </div>
        <datalist id="band-types">{bandTypes.map(t => <option key={t} value={t} />)}</datalist>
        {/* Pre-fill the type from the last row so adding to a set is quick. */}
        <button className="inv-add" onClick={() => add("bands", { type: inv.bands.at(-1)?.type || "", colour: "", strength: "", count: 1 })}>
          + Add band
        </button>
      </SubSection>
    </Section>
  );
}
