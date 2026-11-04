import type { Band, Bar, Entry, EquipmentType, Inventory, Participant } from "./types";

export const WEIGHT_TOOLTIP = "Enter the total weight (bar + all plates combined)";
export const RIR_TOOLTIP = "Reps in reserve — how many more reps you could have done";
export const KM_PER_MILE = 1.609344;
export type DistanceUnit = "km" | "mi";

export const EQUIPMENT_LABELS: Record<EquipmentType, string> = {
  weight: "Weight", barbell: "Barbell", plates: "Plates", dumbbell: "Dumbbell", band: "Band", bodyweight: "Bodyweight", cardio: "Cardio",
};

export function todayISO(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function formatDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
  });
}

export const fmt = (n: number) => Math.round(n).toLocaleString();
export const fmtKg1 = (v: number) => `${(Math.round(v * 10) / 10).toFixed(1)} kg`;
export const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// ---------- Volume ----------

export function entryVolume(e: Entry): number {
  const mult = e.equipment_type === "dumbbell" ? e.dumbbell_count || 2 : 1;
  return e.sets.reduce((sum, s) => sum + (s.reps || 0) * (s.weight_kg || 0) * mult, 0);
}
export function participantVolume(p: Participant): number {
  return p.entries.reduce((sum, e) => sum + entryVolume(e), 0);
}

// ---------- Cardio ----------

export const kmToUnit = (km: number, unit: DistanceUnit) => (unit === "mi" ? km / KM_PER_MILE : km);
export const unitToKm = (v: number, unit: DistanceUnit) => (unit === "mi" ? v * KM_PER_MILE : v);

/** Accepts "h:mm:ss", "mm:ss" or plain minutes ("30", "27.5"). Returns seconds, or null. */
export function parseDuration(str: string): number | null {
  const t = String(str || "").trim();
  if (!t) return null;
  if (t.includes(":")) {
    const parts = t.split(":").map(Number);
    if (parts.length > 3 || parts.some(n => isNaN(n) || n < 0)) return null;
    const sec = parts.reduce((acc, n) => acc * 60 + n, 0);
    return sec > 0 ? Math.round(sec) : null;
  }
  const min = parseFloat(t);
  return !isNaN(min) && min > 0 ? Math.round(min * 60) : null;
}

export function formatDuration(sec: number): string {
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(total % 60)}` : `${m}:${pad(total % 60)}`;
}

export function fmtDist(km: number, unit: DistanceUnit): string {
  return `${(Math.round(kmToUnit(km, unit) * 100) / 100).toFixed(2)} ${unit}`;
}

/** e.g. "10.5 km/h · 5:43 /km" or "6.5 mph · 9:12 /mi". */
export function speedText(distanceKm: number, durationSec: number, unit: DistanceUnit): string {
  if (!(distanceKm > 0) || !(durationSec > 0)) return "";
  const dist = kmToUnit(distanceKm, unit);
  const speed = dist / (durationSec / 3600);
  return `${speed.toFixed(1)} ${unit === "mi" ? "mph" : "km/h"} · ${formatDuration(durationSec / dist)} /${unit}`;
}

export function cardioSummary(distanceKm: number, durationSec: number, unit: DistanceUnit): string {
  const speed = speedText(distanceKm, durationSec, unit);
  return `${fmtDist(distanceKm, unit)} in ${formatDuration(durationSec)}${speed ? ` · ${speed}` : ""}`;
}

export function cardioTotals(e: Entry) {
  return e.sets.reduce((t, s) => ({
    durationSec: t.durationSec + (s.duration_sec || 0),
    distanceKm: t.distanceKm + (s.distance_km || 0),
  }), { durationSec: 0, distanceKm: 0 });
}

// ---------- Bands ----------

export const bandLabel = (b: Band) => [b.type, b.colour].filter(Boolean).join(" · ");

export function setBandLabel(bandIds: number[], inv: Inventory): string {
  const all = [...inv.bands, ...inv.archived_bands];
  const bands = bandIds.map(id => all.find(b => b.id === id));
  return bands.length && bands.every(Boolean) ? bands.map(b => bandLabel(b!)).join(" + ") : "Band";
}

// ---------- Bars & plates ----------

const EPS = 1e-4;

export function defaultBar(inv: Inventory): Bar {
  return inv.bars.find(b => b.kg > 0) || { id: 0, name: "Bar", kg: 15 };
}
export function resolveBar(e: Entry, inv: Inventory): Bar {
  return (e.bar_id != null && inv.bars.find(b => b.id === e.bar_id && b.kg > 0)) || defaultBar(inv);
}

/** Plate pairs available, heaviest first; duplicates merged, odd plates dropped. */
export function platePairs(inv: Inventory) {
  const merged = new Map<number, number>();
  inv.plates.forEach(p => {
    const pairs = Math.floor((p.count || 0) / 2);
    if (p.kg > 0 && pairs) merged.set(p.kg, (merged.get(p.kg) || 0) + pairs);
  });
  return [...merged.entries()].map(([kg, pairs]) => ({ kg, pairs })).sort((a, b) => b.kg - a.kg);
}

export type PlateResult =
  | { type: "below_bar"; bar: number }
  | { type: "exact" | "partial"; plates: number[]; achieved: number; leftover: number; bar: number };

/** Individual plates available, heaviest first; duplicates merged. */
function plateCounts(inv: Inventory) {
  const merged = new Map<number, number>();
  inv.plates.forEach(p => {
    if (p.kg > 0 && p.count) merged.set(p.kg, (merged.get(p.kg) || 0) + p.count);
  });
  return [...merged.entries()].map(([kg, pairs]) => ({ kg, pairs })).sort((a, b) => b.kg - a.kg);
}

/** Plates per side for a barbell, or with barKg null, the plates making up the whole weight (no bar). */
export function calcPlates(targetKg: number, barKg: number | null, inv: Inventory): PlateResult | null {
  if (!targetKg || isNaN(targetKg) || targetKg <= 0) return null;
  const bar = barKg ?? 0;
  const sides = barKg == null ? 1 : 2;
  if (targetKg < bar - EPS) return { type: "below_bar", bar };
  let remaining = (targetKg - bar) / sides;
  const plates: number[] = [];
  for (const { kg, pairs } of barKg == null ? plateCounts(inv) : platePairs(inv)) {
    let used = 0;
    while (remaining >= kg - EPS && used < pairs) {
      plates.push(kg);
      remaining -= kg;
      used++;
    }
  }
  const leftover = Math.max(0, Math.round(remaining * 100) / 100);
  return {
    type: leftover > 0 ? "partial" : "exact",
    plates,
    achieved: bar + sides * plates.reduce((a, b) => a + b, 0),
    leftover,
    bar,
  };
}

/** Smallest loadable step: twice the smallest plate (plates go on in pairs). */
export function smallestIncrement(inv: Inventory): number {
  const pairs = platePairs(inv);
  return pairs.length ? Math.min(...pairs.map(p => p.kg)) * 2 : 2.5;
}

export function downloadFile(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
