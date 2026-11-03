import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";
import type { DistanceUnit } from "./format";
import type { Exercise, ExerciseSummary, Inventory, Person, PR, Session, Target } from "./types";

// ---------- Server data ----------

interface Data {
  sessions: Session[];
  people: Person[];
  exercises: Exercise[];
  summary: ExerciseSummary[];
  inventory: Inventory;
  targets: Target[];
  prs: PR[];
}

const EMPTY_INVENTORY: Inventory = {
  bars: [], plates: [], dumbbells: [], kettlebells: [], accessories: [], bands: [], archived_bands: [],
};

// ---------- UI preferences (this browser only) ----------

const UI_KEY = "gym-tracker-react-ui";

interface UiPrefs {
  collapsed: Record<string, boolean>;
  distanceUnit: DistanceUnit;
  viewingId: number | null;
}

const DEFAULT_COLLAPSED: Record<string, boolean> = {
  plateEditor: true, exerciseList: true, people: true,
};

function loadUi(): UiPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(UI_KEY) || "{}");
    return {
      collapsed: { ...DEFAULT_COLLAPSED, ...(raw.collapsed || {}) },
      distanceUnit: raw.distanceUnit === "mi" ? "mi" : "km",
      viewingId: typeof raw.viewingId === "number" ? raw.viewingId : null,
    };
  } catch {
    return { collapsed: { ...DEFAULT_COLLAPSED }, distanceUnit: "km", viewingId: null };
  }
}

interface Store extends Data {
  loaded: boolean;
  error: string | null;
  /** Runs a change against the API, then reloads everything. Shows errors as alerts. */
  run: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
  reload: () => Promise<void>;
  active: Session | null;
  viewing: Session | null;
  setViewingId: (id: number | null) => void;
  isCollapsed: (key: string) => boolean;
  toggleCollapsed: (key: string) => void;
  setCollapsed: (key: string, value: boolean) => void;
  distanceUnit: DistanceUnit;
  setDistanceUnit: (u: DistanceUnit) => void;
  prFor: (personId: number, exerciseId: number) => PR | undefined;
  targetFor: (personId: number, exerciseId: number) => Target | undefined;
  // Cross-section hand-offs.
  bestLookup: { person: string; exercise: string };
  setBestLookup: (v: { person: string; exercise: string }) => void;
  historyFilter: { person: string; exercise: string };
  setHistoryFilter: (v: { person: string; exercise: string }) => void;
}

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Data>({
    sessions: [], people: [], exercises: [], summary: [], inventory: EMPTY_INVENTORY, targets: [], prs: [],
  });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ui, setUi] = useState<UiPrefs>(loadUi);
  const [bestLookup, setBestLookup] = useState({ person: "", exercise: "" });
  const [historyFilter, setHistoryFilter] = useState({ person: "", exercise: "" });

  useEffect(() => {
    try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch { /* storage unavailable */ }
  }, [ui]);

  const reload = useCallback(async () => {
    try {
      const [sessions, people, exercises, summary, inventory, targets, prs] = await Promise.all([
        api.sessions(), api.people(), api.exercises(), api.exerciseSummary(), api.inventory(), api.targets(), api.prs(),
      ]);
      setData({ sessions, people, exercises, summary, inventory, targets, prs });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const run = useCallback(async <T,>(fn: () => Promise<T>) => {
    try {
      const result = await fn();
      await reload();
      return result;
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
      await reload();
      return undefined;
    }
  }, [reload]);

  const store = useMemo<Store>(() => {
    const active = data.sessions.find(s => s.status === "active") || null;
    const viewing = ui.viewingId != null ? data.sessions.find(s => s.id === ui.viewingId) || null : null;
    const prMap = new Map(data.prs.map(p => [`${p.person_id}:${p.exercise_id}`, p]));
    const targetMap = new Map(data.targets.map(t => [`${t.person_id}:${t.exercise_id}`, t]));
    return {
      ...data,
      loaded,
      error,
      run,
      reload,
      active,
      viewing,
      setViewingId: id => setUi(u => ({ ...u, viewingId: id })),
      isCollapsed: key => !!ui.collapsed[key],
      toggleCollapsed: key => setUi(u => ({ ...u, collapsed: { ...u.collapsed, [key]: !u.collapsed[key] } })),
      setCollapsed: (key, value) => setUi(u => ({ ...u, collapsed: { ...u.collapsed, [key]: value } })),
      distanceUnit: ui.distanceUnit,
      setDistanceUnit: distanceUnit => setUi(u => ({ ...u, distanceUnit })),
      prFor: (pid, eid) => prMap.get(`${pid}:${eid}`),
      targetFor: (pid, eid) => targetMap.get(`${pid}:${eid}`),
      bestLookup,
      setBestLookup,
      historyFilter,
      setHistoryFilter,
    };
  }, [data, loaded, error, run, reload, ui, bestLookup, historyFilter]);

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error("useStore outside StoreProvider");
  return s;
}
