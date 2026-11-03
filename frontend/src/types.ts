// Shapes returned by the FastAPI backend (see backend/app/schemas.py).

export type EquipmentType = "weight" | "barbell" | "dumbbell" | "band" | "bodyweight" | "cardio";
export type ExerciseKind = "strength" | "cardio";

export interface Person {
  id: number;
  name: string;
}

export interface Exercise {
  id: number;
  name: string;
  kind: ExerciseKind;
  equipment_type: EquipmentType;
}

export interface PersonBest {
  person_id: number;
  person: string;
  weight_kg: number | null;
  distance_km: number | null;
}

export interface ExerciseSummary extends Exercise {
  times: number;
  last_date: string | null;
  bests: PersonBest[];
}

export interface WorkSet {
  id: number;
  reps: number | null;
  weight_kg: number | null;
  rir: number | null;
  duration_sec: number | null;
  distance_km: number | null;
  band_ids: number[];
}

export interface Entry {
  id: number;
  exercise_id: number;
  name: string;
  kind: ExerciseKind;
  equipment_type: EquipmentType;
  bar_id: number | null;
  dumbbell_count: number;
  notes: string;
  sets: WorkSet[];
}

export interface Participant {
  id: number;
  person_id: number;
  name: string;
  entries: Entry[];
}

export interface Session {
  id: number;
  date: string;
  status: "active" | "finished";
  participants: Participant[];
}

export interface SetInput {
  reps?: number | null;
  weight_kg?: number | null;
  rir?: number | null;
  duration_sec?: number | null;
  distance_km?: number | null;
  band_ids?: number[];
}

export interface BestAt {
  weight_kg: number;
  date: string;
  rir: number | null;
}

export interface Target {
  id: number;
  person_id: number;
  person: string;
  exercise_id: number;
  exercise: string;
  weight_kg: number;
  reps: number;
  set_at: string;
  best: BestAt | null;
  achieved: boolean;
  pct: number;
  est_1rm: number | null;
  actual_1rm: number | null;
}

export interface PR {
  person_id: number;
  person: string;
  exercise_id: number;
  exercise: string;
  weight_kg: number;
  reps: number | null;
}

export interface BestTable {
  rows: { reps: number; best: BestAt | null }[];
  est_1rm: number | null;
}

export interface Bar {
  id: number;
  name: string;
  kg: number;
}
export interface LooseWeight {
  id: number;
  kg: number;
  count: number;
}
export interface Accessory {
  id: number;
  name: string;
  count: number;
}
export interface Band {
  id: number;
  type: string;
  colour: string;
  strength: string;
  count: number;
}

export interface Inventory {
  bars: Bar[];
  plates: LooseWeight[];
  dumbbells: LooseWeight[];
  kettlebells: LooseWeight[];
  accessories: Accessory[];
  bands: Band[];
  archived_bands: Band[];
}

export type InventoryList = "bars" | "plates" | "dumbbells" | "kettlebells" | "accessories" | "bands";

export interface ImportResult {
  sessions: number;
  warnings: string[];
}
