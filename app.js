const STORAGE_KEY = "gym-tracker-sessions";
const UI_STATE_KEY = "gym-tracker-ui";
const INVENTORY_KEY = "gym-tracker-inventory";
const TARGETS_KEY = "gym-tracker-targets";

const DEFAULT_INVENTORY = {
  bars: [
    { id: "bar-mens", name: "Men's bar", kg: 20 },
    { id: "bar-womens", name: "Women's bar", kg: 15 },
    { id: "bar-ez", name: "EZ bar", kg: 9.5 },
  ],
  plates: [
    { kg: 20,   count: 4 },
    { kg: 15,   count: 2 },
    { kg: 10,   count: 2 },
    { kg: 5,    count: 2 },
    { kg: 2.5,  count: 4 },
    { kg: 1.25, count: 4 },
    { kg: 0.25, count: 4 },
  ],
};
const WEIGHT_TOOLTIP = "Enter the total weight (bar + all plates combined)";
const RIR_TOOLTIP = "Reps in reserve — how many more reps you could have done";

const state = {
  sessions: [],
  currentId: null,   // session currently being logged
  viewingId: null,   // past session opened for inspection (read-mostly)
  editingSetId: null,
  editingExerciseId: null,
  editingParticipantId: null,
  editingNotesId: null,
  editingSessionDateId: null,
  openPRCalcId: null,
  helperWeight: null,
  bestLookup: { personName: "", exerciseName: "" },
  targets: [],
  editingTargetKey: null,
  plateInventory: JSON.parse(JSON.stringify(DEFAULT_INVENTORY)),
  uiCollapsed: { prHelper: false, plateEditor: true, targetsOverview: false },
  setup: { date: todayISO(), count: null, names: [] },
};

function loadTargets() {
  try {
    const raw = localStorage.getItem(TARGETS_KEY);
    if (raw) {
      const t = JSON.parse(raw);
      if (Array.isArray(t)) state.targets = t;
    }
  } catch {}
}

function saveTargets() {
  localStorage.setItem(TARGETS_KEY, JSON.stringify(state.targets));
}

function targetMatches(t, person, exercise) {
  return (t.person || "").trim().toLowerCase() === (person || "").trim().toLowerCase()
    && (t.exercise || "").trim().toLowerCase() === (exercise || "").trim().toLowerCase();
}

function getTarget(person, exercise) {
  if (!(person || "").trim() || !(exercise || "").trim()) return null;
  return state.targets.find(t => targetMatches(t, person, exercise)) || null;
}

function setTarget(person, exercise, weight, reps) {
  state.targets = state.targets.filter(t => !targetMatches(t, person, exercise));
  state.targets.push({ person: person.trim(), exercise: exercise.trim(), weight, reps, setAt: todayISO() });
  saveTargets();
}

function clearTarget(person, exercise) {
  state.targets = state.targets.filter(t => !targetMatches(t, person, exercise));
  saveTargets();
}

function load() {
  loadInventory();
  loadTargets();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    state.sessions = raw ? JSON.parse(raw) : [];
    migrate();
    const uiRaw = localStorage.getItem(UI_STATE_KEY);
    if (uiRaw) {
      const ui = JSON.parse(uiRaw);
      if (ui.currentId && state.sessions.some(s => s.id === ui.currentId)) {
        state.currentId = ui.currentId;
      }
      if (ui.viewingId && state.sessions.some(s => s.id === ui.viewingId)) {
        state.viewingId = ui.viewingId;
      }
      if (ui.uiCollapsed) {
        state.uiCollapsed = { ...state.uiCollapsed, ...ui.uiCollapsed };
      }
    }
  } catch {
    state.sessions = [];
  }
}

function loadInventory() {
  try {
    const raw = localStorage.getItem(INVENTORY_KEY);
    if (raw) {
      const inv = JSON.parse(raw);
      if (inv && Array.isArray(inv.plates)) {
        // Migrate single `bar: N` shape to the named-bars list.
        if (!Array.isArray(inv.bars)) {
          const bars = JSON.parse(JSON.stringify(DEFAULT_INVENTORY.bars));
          const oldKg = Number(inv.bar);
          if (oldKg > 0) {
            const idx = bars.findIndex(b => Math.abs(b.kg - oldKg) < EPS);
            if (idx > 0) bars.unshift(bars.splice(idx, 1)[0]);
            else if (idx < 0) bars.unshift({ id: uid(), name: `Bar ${oldKg} kg`, kg: oldKg });
          }
          inv.bars = bars;
          delete inv.bar;
          state.plateInventory = inv;
          saveInventory();
        } else {
          state.plateInventory = inv;
        }
      }
    }
  } catch {}
}

function saveInventory() {
  localStorage.setItem(INVENTORY_KEY, JSON.stringify(state.plateInventory));
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.sessions));
  saveUI();
}

function saveUI() {
  localStorage.setItem(UI_STATE_KEY, JSON.stringify({
    currentId: state.currentId,
    viewingId: state.viewingId,
    uiCollapsed: state.uiCollapsed,
  }));
}

function migrate() {
  let changed = false;
  state.sessions.forEach(s => {
    if (Array.isArray(s.exercises) && !Array.isArray(s.participants)) {
      s.participants = [{ id: uid(), name: "Me", exercises: s.exercises }];
      delete s.exercises;
      changed = true;
    }
    if (!Array.isArray(s.participants)) {
      s.participants = [];
      changed = true;
    }
    s.participants.forEach(p => {
      p.exercises = (p.exercises || []).map(ex => {
        if (Array.isArray(ex.sets)) return ex;
        changed = true;
        const count = Number(ex.sets) || 1;
        const sets = [];
        for (let i = 0; i < count; i++) {
          sets.push({ id: uid(), reps: Number(ex.reps) || 0, weight: Number(ex.weight) || 0 });
        }
        return { id: ex.id || uid(), name: ex.name, sets };
      });
      // Migrate showPlates/barKg -> equipment
      p.exercises.forEach(ex => {
        if (ex.showPlates == null && ex.barKg == null) return;
        if (ex.showPlates && !ex.equipment) {
          let barId = null;
          if (ex.barKg != null) {
            const m = (state.plateInventory.bars || []).find(b => Math.abs(Number(b.kg) - Number(ex.barKg)) < EPS);
            if (m) barId = m.id;
          }
          ex.equipment = barId ? { type: "barbell", barId } : { type: "barbell" };
        }
        delete ex.showPlates;
        delete ex.barKg;
        changed = true;
      });
    });
  });
  if (changed) save();
}

function todayISO() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

function formatDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function getCurrentSession() {
  return state.sessions.find(s => s.id === state.currentId) || null;
}
function getViewingSession() {
  return state.sessions.find(s => s.id === state.viewingId) || null;
}

// ---------- Known values for autocomplete ----------

function getKnownNames() {
  const set = new Set();
  state.sessions.forEach(s => s.participants.forEach(p => {
    const n = (p.name || "").trim();
    if (n) set.add(n);
  }));
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function getKnownExercises() {
  const set = new Set();
  state.sessions.forEach(s => s.participants.forEach(p =>
    p.exercises.forEach(ex => {
      const n = (ex.name || "").trim();
      if (n) set.add(n);
    })
  ));
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function renderDatalists() {
  let host = document.getElementById("datalists");
  if (!host) {
    host = document.createElement("div");
    host.id = "datalists";
    document.body.appendChild(host);
  }
  const names = getKnownNames().map(n => `<option value="${escapeHtml(n)}"></option>`).join("");
  const exercises = getKnownExercises().map(n => `<option value="${escapeHtml(n)}"></option>`).join("");
  host.innerHTML = `
    <datalist id="known-names">${names}</datalist>
    <datalist id="known-exercises">${exercises}</datalist>
  `;
}

// ---------- Volume calculations ----------

function exerciseVolume(ex) {
  const mult = ex.equipment && ex.equipment.type === "dumbbell" ? (ex.equipment.dumbbellCount || 2) : 1;
  return ex.sets.reduce((sum, s) => sum + (Number(s.reps) || 0) * (Number(s.weight) || 0) * mult, 0);
}
function participantVolume(p) {
  return p.exercises.reduce((sum, ex) => sum + exerciseVolume(ex), 0);
}
function fmt(n) {
  return Math.round(n).toLocaleString();
}

// ---------- Plate calculator ----------

// Read plate inventory from state, merging duplicate weights and dropping unpaired plates.
function getPlates() {
  const merged = new Map();
  (state.plateInventory.plates || []).forEach(p => {
    const kg = Number(p.kg);
    const count = Number(p.count) || 0;
    if (!kg || kg <= 0 || count <= 0) return;
    const pairs = Math.floor(count / 2);
    if (!pairs) return;
    merged.set(kg, (merged.get(kg) || 0) + pairs);
  });
  return Array.from(merged.entries())
    .map(([kg, pairs]) => ({ kg, pairs }))
    .sort((a, b) => b.kg - a.kg);
}
function getBars() {
  return (state.plateInventory.bars || []).filter(b => b && Number(b.kg) > 0);
}
function getDefaultBar() {
  const bars = getBars();
  return bars.length ? bars[0] : { id: null, name: "Bar", kg: 15 };
}
function getBarById(id) {
  return getBars().find(b => b.id === id) || null;
}
// The bar an exercise's plate math should use.
function resolveBar(exercise) {
  const eq = exercise && exercise.equipment;
  if (eq && eq.type === "barbell" && eq.barId) {
    const b = getBarById(eq.barId);
    if (b) return b;
  }
  return getDefaultBar();
}
function getBarKg() {
  return getDefaultBar().kg;
}
const EPS = 1e-4;

function calcPlates(targetKg, barOverride) {
  if (!targetKg || isNaN(targetKg) || targetKg <= 0) return null;
  const bar = (barOverride != null && !isNaN(Number(barOverride))) ? Number(barOverride) : getBarKg();
  if (targetKg < bar - EPS) return { type: "below_bar", bar };
  if (Math.abs(targetKg - bar) < EPS) {
    return { type: "exact", perSide: 0, plates: [], achieved: bar, leftover: 0, bar };
  }
  const perSide = (targetKg - bar) / 2;
  const plates = [];
  let remaining = perSide;
  for (const { kg, pairs } of getPlates()) {
    let used = 0;
    while (remaining >= kg - EPS && used < pairs) {
      plates.push(kg);
      remaining -= kg;
      used++;
    }
  }
  const leftover = Math.max(0, Math.round(remaining * 100) / 100);
  const achieved = bar + 2 * plates.reduce((a, b) => a + b, 0);
  return {
    type: leftover > 0 ? "partial" : "exact",
    perSide,
    plates,
    achieved,
    leftover,
  };
}

function renderPlatesHintHtml(weight, barOverride) {
  const r = calcPlates(weight, barOverride);
  if (!r) return "";
  const bar = r.bar != null ? r.bar : getBarKg();
  if (r.type === "below_bar") {
    return `<div class="plates-hint warning">Below bar weight (${bar} kg)</div>`;
  }
  if (r.plates.length === 0) {
    return `<div class="plates-hint">Empty bar (${bar} kg)</div>`;
  }
  const grouped = new Map();
  r.plates.forEach(kg => grouped.set(kg, (grouped.get(kg) || 0) + 1));
  const badges = Array.from(grouped.entries())
    .map(([kg, ct]) => `<span class="plate-badge">${kg}${ct > 1 ? `<span class="plate-ct">×${ct}</span>` : ""}</span>`)
    .join("");
  const leftoverHtml = r.type === "partial"
    ? `<span class="plates-leftover">closest: ${r.achieved} kg (short ${r.leftover} kg/side)</span>`
    : "";
  return `
    <div class="plates-hint">
      <span class="plates-label">Per side</span>
      <span class="plates-badges">${badges}</span>
      ${leftoverHtml}
    </div>
  `;
}

// ---------- Personal records ----------

// Highest weight ever lifted by this person on this exercise, across all sessions.
function getPR(exerciseName, personName) {
  const targetEx = (exerciseName || "").trim().toLowerCase();
  const targetP = (personName || "").trim().toLowerCase();
  if (!targetEx || !targetP) return null;
  let max = -Infinity;
  let best = null;
  state.sessions.forEach(s => s.participants.forEach(p => {
    if ((p.name || "").trim().toLowerCase() !== targetP) return;
    p.exercises.forEach(ex => {
      if ((ex.name || "").trim().toLowerCase() !== targetEx) return;
      ex.sets.forEach(set => {
        const w = Number(set.weight) || 0;
        if (w > max) { max = w; best = set; }
      });
    });
  }));
  return best ? { weight: max, reps: best.reps } : null;
}

function prHtml(exerciseName, personName) {
  const pr = getPR(exerciseName, personName);
  return pr ? ` <span class="pr-tag" title="Personal record — heaviest weight lifted">(PR: ${pr.weight} kg)</span>` : "";
}

// Smallest realistic total-weight step given the current plate inventory:
// twice the smallest available plate (plates load in pairs). Falls back to
// 2.5 kg if the inventory is empty.
function smallestIncrement() {
  const plates = getPlates();
  if (!plates.length) return 2.5;
  const smallest = Math.min(...plates.map(p => p.kg));
  return smallest * 2;
}

// Percentages of PR in 5% steps from 50% to 100%, rounded to the smallest
// loadable increment. Laid out as two side-by-side columns for compactness.
function renderPRCalcHtml(pr) {
  if (!pr) return "";
  const step = smallestIncrement();
  const pcts = [50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100];
  const round = w => {
    const r = Math.round(w / step) * step;
    // Trim trailing zeros: 40.0 -> "40", 42.5 -> "42.5"
    return (Math.round(r * 100) / 100).toString();
  };
  const half = Math.ceil(pcts.length / 2);
  const left = pcts.slice(0, half);
  const right = pcts.slice(half);
  const cell = (p) => p != null
    ? `<span class="pct">${p}%</span><span class="wt">${round(pr.weight * p / 100)} kg</span>`
    : `<span></span><span></span>`;
  let cells = "";
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    cells += cell(left[i]) + cell(right[i]);
  }
  return `
    <div class="pr-calc">
      <div class="pr-calc-header">PR ${pr.weight} kg · ${step} kg increments</div>
      <div class="pr-calc-grid">${cells}</div>
    </div>
  `;
}

// All known PRs across people and exercises, sorted by weight desc.
function getAllPRs() {
  const map = new Map();
  state.sessions.forEach(s => s.participants.forEach(p => {
    p.exercises.forEach(ex => {
      ex.sets.forEach(set => {
        const w = Number(set.weight) || 0;
        if (!w) return;
        const key = `${(p.name || "").trim().toLowerCase()}::${(ex.name || "").trim().toLowerCase()}`;
        const prev = map.get(key);
        if (!prev || w > prev.weight) {
          map.set(key, { personName: p.name, exerciseName: ex.name, weight: w });
        }
      });
    });
  }));
  return Array.from(map.values()).sort((a, b) => b.weight - a.weight);
}

// Rename every participant matching `fromName` (case-insensitive) to `toName`
// across every session. Use this to fix typos / merge name variants.
function renameParticipant(fromName, toName) {
  const target = (toName || "").trim();
  if (!target) return 0;
  const fromKey = (fromName || "").trim().toLowerCase();
  let count = 0;
  state.sessions.forEach(s => s.participants.forEach(p => {
    if ((p.name || "").trim().toLowerCase() === fromKey && p.name !== target) {
      p.name = target;
      count++;
    }
  }));
  if (count) save();
  return count;
}

// Most recent equipment config used for this exercise name, preferring the
// same person's history over other participants'.
function findLastEquipment(exName, personName) {
  const eLower = (exName || "").trim().toLowerCase();
  const pLower = (personName || "").trim().toLowerCase();
  let best = null;
  state.sessions.forEach(s => s.participants.forEach(p => {
    p.exercises.forEach(ex => {
      if ((ex.name || "").trim().toLowerCase() !== eLower) return;
      if (!ex.equipment) return;
      const cand = {
        date: s.date || "",
        samePerson: (p.name || "").trim().toLowerCase() === pLower,
        equipment: ex.equipment,
      };
      if (!best) { best = cand; return; }
      if (cand.samePerson !== best.samePerson) {
        if (cand.samePerson) best = cand;
        return;
      }
      if (cand.date > best.date) best = cand;
    });
  }));
  return best ? best.equipment : null;
}

// Rename every exercise matching `fromName` (case-insensitive) for `personName`
// to `toName`, across every session. This is how variant spellings get merged.
function renameExercise(personName, fromName, toName) {
  const target = (toName || "").trim();
  if (!target) return 0;
  const personKey = (personName || "").trim().toLowerCase();
  const fromKey = (fromName || "").trim().toLowerCase();
  let count = 0;
  state.sessions.forEach(s => s.participants.forEach(p => {
    if ((p.name || "").trim().toLowerCase() !== personKey) return;
    p.exercises.forEach(ex => {
      if ((ex.name || "").trim().toLowerCase() === fromKey && ex.name !== target) {
        ex.name = target;
        count++;
      }
    });
  }));
  if (count) save();
  return count;
}

// ---------- Render ----------

function render() {
  const viewing = getViewingSession();
  const active = getCurrentSession();
  const shown = viewing || active;
  const container = document.querySelector(".container");
  container.classList.toggle("wide", !!shown && shown.participants.length > 1);
  // Side-by-side session + best-lookup layout (takes effect on wide screens).
  container.classList.toggle("has-session", !!shown);
  document.getElementById("history-heading").style.display = viewing ? "none" : "";
  renderDatalists();
  renderStart();
  renderSession();
  renderBestLookup();
  renderTargetsOverview();
  renderPRHelper();
  renderPlateEditor();
  renderDataTools();
  renderHistory();
}

function exportAllData() {
  // Inject explicit set numbers (1-indexed) for downstream tools that don't preserve array order.
  const sessions = state.sessions.map(s => ({
    ...s,
    participants: s.participants.map(p => ({
      ...p,
      exercises: p.exercises.map(ex => ({
        ...ex,
        sets: ex.sets.map((set, i) => ({ setNumber: i + 1, ...set })),
      })),
    })),
  }));
  const payload = {
    exportedAt: new Date().toISOString(),
    schemaVersion: 4,
    sessions,
    plateInventory: state.plateInventory,
    targets: state.targets,
  };
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const date = new Date().toISOString().slice(0, 10);
  const a = document.createElement("a");
  a.href = url;
  a.download = `gym-tracker-${date}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importAllData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try {
      data = JSON.parse(reader.result);
    } catch {
      alert("That file isn't valid JSON.");
      return;
    }
    // Accept a full export payload or a bare array of sessions.
    const payload = Array.isArray(data) ? { sessions: data } : data;
    if (!payload || !Array.isArray(payload.sessions)) {
      alert("No sessions found in that file. Expected an export from this app.");
      return;
    }
    const incoming = payload.sessions.filter(s => s && typeof s === "object");
    const existingIds = new Set(state.sessions.map(s => s.id));
    const dupes = incoming.filter(s => existingIds.has(s.id)).length;

    let replace = false;
    if (state.sessions.length) {
      replace = confirm(
        `Import ${incoming.length} session(s).\n\n` +
        `OK = replace all current data (${state.sessions.length} session(s)).\n` +
        `Cancel = merge into current data` +
        (dupes ? ` (${dupes} session(s) with matching IDs will be overwritten).` : ".")
      );
    }

    // Strip export-only fields and make sure every record has an id.
    const cleaned = incoming.map(s => ({
      ...s,
      id: s.id || uid(),
      participants: (s.participants || []).map(p => ({
        ...p,
        id: p.id || uid(),
        exercises: (p.exercises || []).map(ex => ({
          ...ex,
          id: ex.id || uid(),
          sets: Array.isArray(ex.sets)
            ? ex.sets.map(({ setNumber, ...set }) => ({ ...set, id: set.id || uid() }))
            : ex.sets,
        })),
      })),
    }));

    if (replace) {
      state.sessions = cleaned;
      state.currentId = null;
      state.viewingId = null;
      if (Array.isArray(payload.targets)) state.targets = payload.targets;
      if (payload.plateInventory && Array.isArray(payload.plateInventory.plates)) {
        state.plateInventory = payload.plateInventory;
      }
    } else {
      const byId = new Map(cleaned.map(s => [s.id, s]));
      state.sessions = state.sessions.map(s => byId.get(s.id) || s);
      const kept = new Set(state.sessions.map(s => s.id));
      cleaned.forEach(s => { if (!kept.has(s.id)) state.sessions.push(s); });
      if (Array.isArray(payload.targets)) {
        payload.targets.forEach(t => {
          state.targets = state.targets.filter(x => !targetMatches(x, t.person, t.exercise));
          state.targets.push(t);
        });
      }
    }
    migrate();
    save();
    saveTargets();
    saveInventory();
    render();
    alert(`Imported ${cleaned.length} session(s).`);
  };
  reader.onerror = () => alert("Couldn't read that file.");
  reader.readAsText(file);
}

function renderDataTools() {
  const root = document.getElementById("data-tools");
  root.innerHTML = "";
  if (getCurrentSession() || getViewingSession()) return;

  const sessionCount = state.sessions.length;
  const setCount = state.sessions.reduce(
    (n, s) => n + s.participants.reduce(
      (m, p) => m + p.exercises.reduce((k, ex) => k + ex.sets.length, 0), 0), 0);

  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `
    <h2 style="margin-top:0">Data</h2>
    <p class="data-tools-note">
      All your data lives in this browser's localStorage. Export to a JSON file
      to back it up or feed it into another tool (Power BI, a script, etc.),
      or import a previous export to restore it.
    </p>
    <div class="data-tools-row">
      <button id="export-json-btn">Export all data (JSON)</button>
      <button id="import-json-btn">Import data (JSON)</button>
      <input type="file" id="import-json-input" accept=".json,application/json" hidden />
      <span class="data-tools-stats">${sessionCount} session${sessionCount === 1 ? "" : "s"} · ${setCount} set${setCount === 1 ? "" : "s"}</span>
    </div>
  `;
  root.appendChild(card);

  card.querySelector("#export-json-btn").addEventListener("click", exportAllData);
  const importInput = card.querySelector("#import-json-input");
  card.querySelector("#import-json-btn").addEventListener("click", () => importInput.click());
  importInput.addEventListener("change", () => {
    if (importInput.files[0]) importAllData(importInput.files[0]);
    importInput.value = "";
  });
}

function renderPlateEditor() {
  const root = document.getElementById("plate-editor");
  root.innerHTML = "";
  if (getCurrentSession() || getViewingSession()) return; // out of session only

  const collapsed = !!state.uiCollapsed.plateEditor;
  if (collapsed) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `<h2 class="card-collapsible collapsed" data-collapse="plateEditor" style="margin:0"><span class="collapse-caret">▸</span> Plates &amp; bars</h2>`;
    root.appendChild(card);
    card.querySelector('[data-collapse="plateEditor"]').addEventListener("click", () => {
      state.uiCollapsed.plateEditor = false;
      saveUI();
      render();
    });
    return;
  }

  const inv = state.plateInventory;
  if (!Array.isArray(inv.bars)) inv.bars = [];
  const card = document.createElement("div");
  card.className = "card";

  const barRowsHtml = inv.bars.map((b, i) => `
    <div class="inv-bar-row-item" data-bidx="${i}">
      <input type="text" class="inv-bar-name" value="${escapeHtml(b.name || "")}" placeholder="Name" />
      <input type="number" class="inv-bar-kg" step="0.5" min="0" value="${b.kg}" />
      <button class="danger small inv-bar-remove" title="Remove this bar">×</button>
    </div>
  `).join("");

  const plateRowsHtml = inv.plates.map((p, i) => {
    const pairs = Math.floor((Number(p.count) || 0) / 2);
    const pairsLabel = pairs === 0 ? "—" : (pairs === 1 ? "1 pair" : `${pairs} pairs`);
    return `
      <div class="inv-row" data-idx="${i}">
        <input type="number" class="inv-kg" step="0.25" min="0" value="${p.kg}" />
        <input type="number" class="inv-count" step="1" min="0" value="${p.count}" />
        <span class="inv-pairs">${pairsLabel}</span>
        <button class="danger small inv-remove" title="Remove this row">×</button>
      </div>
    `;
  }).join("");

  card.innerHTML = `
    <h2 class="card-collapsible" data-collapse="plateEditor" style="margin-top:0"><span class="collapse-caret">▾</span> Plates &amp; bars</h2>
    <div class="inv-bars">
      <label>Bars (first bar is the default)</label>
      <div class="inv-bars-header">
        <span>Name</span>
        <span>Weight (kg)</span>
        <span></span>
      </div>
      <div class="inv-bars-rows">${barRowsHtml}</div>
      <button class="inv-add-bar">+ Add bar</button>
    </div>
    <div class="inv-plates">
      <label>Plates (weight × total plates owned)</label>
      <div class="inv-rows-header">
        <span>Weight (kg)</span>
        <span>Plates</span>
        <span>Loadable</span>
        <span></span>
      </div>
      <div class="inv-rows">${plateRowsHtml}</div>
      <button class="inv-add">+ Add plate size</button>
    </div>
  `;
  root.appendChild(card);

  card.querySelectorAll(".inv-bar-row-item").forEach(row => {
    const i = parseInt(row.getAttribute("data-bidx"), 10);
    const nameInput = row.querySelector(".inv-bar-name");
    const kgInput = row.querySelector(".inv-bar-kg");
    const update = () => {
      inv.bars[i].name = nameInput.value;
      inv.bars[i].kg = parseFloat(kgInput.value) || 0;
      saveInventory();
    };
    nameInput.addEventListener("input", update);
    kgInput.addEventListener("input", update);
    row.querySelector(".inv-bar-remove").addEventListener("click", () => {
      inv.bars.splice(i, 1);
      saveInventory();
      render();
    });
  });
  card.querySelector(".inv-add-bar").addEventListener("click", () => {
    inv.bars.push({ id: uid(), name: "", kg: 0 });
    saveInventory();
    render();
    const rows = document.querySelectorAll("#plate-editor .inv-bar-row-item");
    const last = rows[rows.length - 1];
    if (last) last.querySelector(".inv-bar-name").focus();
  });

  card.querySelectorAll(".inv-row").forEach(row => {
    const i = parseInt(row.getAttribute("data-idx"), 10);
    const kgInput = row.querySelector(".inv-kg");
    const countInput = row.querySelector(".inv-count");
    const pairsLabel = row.querySelector(".inv-pairs");
    const update = () => {
      inv.plates[i].kg = parseFloat(kgInput.value) || 0;
      inv.plates[i].count = parseInt(countInput.value, 10) || 0;
      const pairs = Math.floor(inv.plates[i].count / 2);
      pairsLabel.textContent = pairs === 0 ? "—" : (pairs === 1 ? "1 pair" : `${pairs} pairs`);
      saveInventory();
    };
    kgInput.addEventListener("input", update);
    countInput.addEventListener("input", update);
    row.querySelector(".inv-remove").addEventListener("click", () => {
      inv.plates.splice(i, 1);
      saveInventory();
      render();
    });
  });

  card.querySelector(".inv-add").addEventListener("click", () => {
    inv.plates.push({ kg: 0, count: 0 });
    saveInventory();
    render();
    const rows = document.querySelectorAll("#plate-editor .inv-row");
    const last = rows[rows.length - 1];
    if (last) last.querySelector(".inv-kg").focus();
  });

  card.querySelector('[data-collapse="plateEditor"]').addEventListener("click", () => {
    state.uiCollapsed.plateEditor = true;
    saveUI();
    render();
  });
}

function findBestAtReps(personName, exerciseName, reps) {
  const pLower = (personName || "").trim().toLowerCase();
  const eLower = (exerciseName || "").trim().toLowerCase();
  if (!pLower || !eLower) return null;
  let best = null;
  state.sessions.forEach(s => s.participants.forEach(p => {
    if ((p.name || "").trim().toLowerCase() !== pLower) return;
    p.exercises.forEach(ex => {
      if ((ex.name || "").trim().toLowerCase() !== eLower) return;
      ex.sets.forEach(set => {
        if (Number(set.reps) < reps) return;
        const w = Number(set.weight) || 0;
        if (!best || w > best.weight) {
          best = { weight: w, date: s.date, rir: set.rir };
        }
      });
    });
  }));
  return best;
}

function renderBestTableHtml(personName, exerciseName) {
  if (!personName || !exerciseName) {
    return `<div class="best-empty">Enter a person and an exercise to populate the table.</div>`;
  }
  const rows = [];
  let hasAny = false;
  for (let reps = 1; reps <= 16; reps++) {
    const best = findBestAtReps(personName, exerciseName, reps);
    if (best) hasAny = true;
    rows.push({ reps, best });
  }
  if (!hasAny) {
    return `<div class="best-empty">No sets logged for ${escapeHtml(personName)} · ${escapeHtml(exerciseName)}.</div>`;
  }
  const epley = (w, r) => w * (1 + r / 30);
  const fmtKg = v => `${(Math.round(v * 10) / 10).toFixed(1)} kg`;

  // Precompute the average over the 2–6 rep anchor rows for the headline estimate.
  const anchorRows = rows.filter(r => r.reps >= 2 && r.reps <= 6 && r.best);
  const avgEst = anchorRows.length
    ? anchorRows.reduce((s, r) => s + epley(r.best.weight, r.reps), 0) / anchorRows.length
    : null;

  // Current 1RM reference: the actual best single (row 1's best weight).
  const ref1RM = rows[0] && rows[0].best ? rows[0].best.weight : null;

  const pctCell = best => (best && ref1RM > 0)
    ? `${Math.round(best.weight / ref1RM * 100)}%`
    : `<span class="muted">—</span>`;

  // Reverse Epley: max weight predicted at N reps from the estimated 1RM.
  const revCell = reps => (reps > 1 && avgEst > 0)
    ? fmtKg(avgEst / (1 + reps / 30))
    : `<span class="muted">—</span>`;

  const headline = avgEst != null
    ? `<div class="est-1rm-headline">Est. 1RM: <strong>${fmtKg(avgEst)}</strong><span class="est-1rm-note">Epley, based on your best sets at 2–6 reps</span></div>`
    : "";

  const tbody = rows.map(({ reps, best }) => {
    if (!best) {
      return `<tr><td>${reps}</td><td class="muted">—</td><td class="muted">—</td><td class="best-pct"><span class="muted">—</span></td><td class="best-est">${revCell(reps)}</td></tr>`;
    }
    const revVal = (reps > 1 && avgEst > 0) ? avgEst / (1 + reps / 30) : null;
    const beats = revVal != null && best.weight > revVal + 1e-9;
    return `<tr>
      <td>${reps}</td>
      <td><strong${beats ? ' class="beats-est" title="Beats the Epley prediction at this rep count"' : ""}>${best.weight} kg</strong></td>
      <td class="best-date">${formatDate(best.date)}</td>
      <td class="best-pct">${pctCell(best)}</td>
      <td class="best-est">${revCell(reps)}</td>
    </tr>`;
  }).join("");
  return `
    ${headline}
    <table class="best-table">
      <thead>
        <tr><th>Reps</th><th>Best weight</th><th>Date</th><th title="Best weight as a percentage of your actual best single (row 1).">% of 1RM</th><th title="Max weight predicted at this rep count, worked back from your estimated 1RM (the headline above) using the Epley formula.">Est. max</th></tr>
      </thead>
      <tbody>${tbody}</tbody>
    </table>
  `;
}

function hasAnyBests(personName, exerciseName) {
  for (let r = 1; r <= 16; r++) {
    if (findBestAtReps(personName, exerciseName, r)) return true;
  }
  return false;
}

function downloadBestCsv(personName, exerciseName) {
  const lines = ["Reps,Best weight (kg),Date"];
  for (let reps = 1; reps <= 16; reps++) {
    const best = findBestAtReps(personName, exerciseName, reps);
    if (best) {
      lines.push(`${reps},${best.weight},${best.date}`);
    } else {
      lines.push(`${reps},,`);
    }
  }
  const csv = lines.join("\r\n") + "\r\n";
  const safe = s => s.replace(/[^a-z0-9_-]/gi, "_");
  const filename = `best_${safe(personName)}_${safe(exerciseName)}.csv`.toLowerCase();
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function renderTargetsOverview() {
  const root = document.getElementById("targets-overview");
  root.innerHTML = "";
  if (getCurrentSession() || getViewingSession()) return; // home view only

  const collapsed = !!state.uiCollapsed.targetsOverview;
  if (collapsed) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `<h2 class="card-collapsible collapsed" data-collapse="targetsOverview" style="margin:0"><span class="collapse-caret">▸</span> Targets</h2>`;
    root.appendChild(card);
    card.querySelector('[data-collapse="targetsOverview"]').addEventListener("click", () => {
      state.uiCollapsed.targetsOverview = false;
      saveUI();
      render();
    });
    return;
  }

  const computed = state.targets.map(t => {
    const best = findBestAtReps(t.person, t.exercise, t.reps);
    const achieved = !!(best && best.weight >= t.weight - 1e-9);
    const pct = best ? Math.round(best.weight / t.weight * 100) : 0;
    return { ...t, best, achieved, pct };
  }).sort((a, b) => {
    if (a.achieved !== b.achieved) return a.achieved ? 1 : -1;
    if (!a.achieved && a.pct !== b.pct) return b.pct - a.pct;
    const an = `${a.person} ${a.exercise}`.toLowerCase();
    const bn = `${b.person} ${b.exercise}`.toLowerCase();
    return an.localeCompare(bn);
  });

  const rowsHtml = computed.length === 0
    ? `<div class="empty small">No targets yet — set one in the Best lift lookup.</div>`
    : computed.map((t, i) => `
        <button class="target-ov-row" data-ti="${i}" title="Open in Best lift lookup">
          <span class="target-ov-name">${escapeHtml(t.person)} · ${escapeHtml(t.exercise)}</span>
          <span class="target-ov-goal">${t.weight} kg × ${t.reps}</span>
          <span class="target-ov-progress">
            <span class="target-ov-bar"><span class="target-ov-fill ${t.achieved ? "achieved" : ""}" style="width:${Math.min(100, t.pct)}%"></span></span>
            <span class="target-ov-pct ${t.achieved ? "achieved" : ""}">${t.achieved ? "Achieved" : `${t.pct}%`}</span>
          </span>
        </button>
      `).join("");

  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `
    <h2 class="card-collapsible" data-collapse="targetsOverview" style="margin-top:0"><span class="collapse-caret">▾</span> Targets</h2>
    <div class="target-ov-list">${rowsHtml}</div>
  `;
  root.appendChild(card);

  card.querySelector('[data-collapse="targetsOverview"]').addEventListener("click", () => {
    state.uiCollapsed.targetsOverview = true;
    saveUI();
    render();
  });

  card.querySelectorAll(".target-ov-row").forEach(btn => {
    btn.addEventListener("click", () => {
      const t = computed[parseInt(btn.getAttribute("data-ti"), 10)];
      if (!t) return;
      state.bestLookup.personName = t.person;
      state.bestLookup.exerciseName = t.exercise;
      state.editingTargetKey = null;
      render();
      const el = document.getElementById("best-lookup");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function renderTargetInto(rootEl, personName, exerciseName) {
  const person = (personName || "").trim();
  const exercise = (exerciseName || "").trim();
  if (!rootEl) return;
  if (!person || !exercise) { rootEl.innerHTML = ""; return; }

  const key = `${person.toLowerCase()}::${exercise.toLowerCase()}`;
  const target = getTarget(person, exercise);
  const isEditing = state.editingTargetKey === key;

  const rerender = () => renderTargetInto(rootEl, personName, exerciseName);

  if (isEditing) {
    rootEl.innerHTML = `
      <div class="target-row editing">
        <span class="target-label">Target</span>
        <input type="number" class="target-weight" min="0" step="0.5" placeholder="kg" value="${target ? target.weight : ""}" />
        <span class="target-x">kg ×</span>
        <input type="number" class="target-reps" min="1" step="1" placeholder="reps" value="${target ? target.reps : 1}" />
        <button class="target-save-btn">Save</button>
        <button class="secondary target-cancel-btn">Cancel</button>
      </div>
    `;
    const weightInput = rootEl.querySelector(".target-weight");
    const repsInput = rootEl.querySelector(".target-reps");
    const commit = () => {
      const w = parseFloat(weightInput.value);
      const r = parseInt(repsInput.value, 10);
      if (isNaN(w) || w <= 0 || !r || r < 1) {
        alert("Enter a target weight and rep count.");
        return;
      }
      setTarget(person, exercise, w, r);
      state.editingTargetKey = null;
      render();
    };
    rootEl.querySelector(".target-save-btn").addEventListener("click", commit);
    rootEl.querySelector(".target-cancel-btn").addEventListener("click", () => {
      state.editingTargetKey = null;
      rerender();
    });
    [weightInput, repsInput].forEach(inp => {
      inp.addEventListener("keydown", e => {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        if (e.key === "Escape") { state.editingTargetKey = null; rerender(); }
      });
    });
    weightInput.focus();
    return;
  }

  if (!target) {
    rootEl.innerHTML = `
      <div class="target-row empty">
        <span class="target-label">Target</span>
        <button class="icon target-set-btn">Set target</button>
      </div>
    `;
    rootEl.querySelector(".target-set-btn").addEventListener("click", () => {
      state.editingTargetKey = key;
      rerender();
    });
    return;
  }

  const best = findBestAtReps(person, exercise, target.reps);
  const achieved = best && best.weight >= target.weight - 1e-9;
  const pct = best ? Math.round(best.weight / target.weight * 100) : 0;
  const statusHtml = achieved
    ? `<span class="target-status achieved" title="Your best at ${target.reps}+ reps (${best.weight} kg) meets the target">Achieved</span>`
    : `<span class="target-status">best ${best ? `${best.weight} kg` : "—"} · ${pct}%</span>`;

  rootEl.innerHTML = `
    <div class="target-row">
      <span class="target-label">Target</span>
      <span class="target-value ${achieved ? "achieved" : ""}">${target.weight} kg × ${target.reps}</span>
      ${statusHtml}
      <span class="target-actions">
        <button class="icon target-edit-btn">Edit</button>
        <button class="danger target-clear-btn">Clear</button>
      </span>
    </div>
  `;
  rootEl.querySelector(".target-edit-btn").addEventListener("click", () => {
    state.editingTargetKey = key;
    rerender();
  });
  rootEl.querySelector(".target-clear-btn").addEventListener("click", () => {
    if (!confirm(`Clear the target for ${person} · ${exercise}?`)) return;
    clearTarget(person, exercise);
    render();
  });
}

function renderBestLookup() {
  const root = document.getElementById("best-lookup");
  root.innerHTML = "";
  const lookup = state.bestLookup;

  const card = document.createElement("div");
  card.className = "card";
  const canDownload = hasAnyBests(lookup.personName, lookup.exerciseName);

  card.innerHTML = `
    <div class="best-header">
      <h2 style="margin:0">Best lift lookup</h2>
      <button class="icon" id="best-download-csv" ${canDownload ? "" : "disabled"} title="Download the table as CSV">Download CSV</button>
    </div>
    <div class="best-lookup-form">
      <div class="best-person-ex">
        <div>
          <label>Person</label>
          <input type="text" class="best-person" value="${escapeHtml(lookup.personName || "")}" list="known-names" autocomplete="off" placeholder="Name" />
        </div>
        <div>
          <label>Exercise</label>
          <input type="text" class="best-exercise" value="${escapeHtml(lookup.exerciseName || "")}" list="known-exercises" autocomplete="off" placeholder="e.g. Bench press" />
        </div>
      </div>
    </div>
    <div class="target-root"></div>
    <div class="best-result">${renderBestTableHtml(lookup.personName, lookup.exerciseName)}</div>
  `;
  root.appendChild(card);

  const personInput = card.querySelector(".best-person");
  const exerciseInput = card.querySelector(".best-exercise");
  const resultDiv = card.querySelector(".best-result");
  const downloadBtn = card.querySelector("#best-download-csv");
  const targetRoot = card.querySelector(".target-root");
  renderTargetInto(targetRoot, lookup.personName, lookup.exerciseName);

  const recalc = () => {
    lookup.personName = personInput.value.trim();
    lookup.exerciseName = exerciseInput.value.trim();
    resultDiv.innerHTML = renderBestTableHtml(lookup.personName, lookup.exerciseName);
    downloadBtn.disabled = !hasAnyBests(lookup.personName, lookup.exerciseName);
    renderTargetInto(targetRoot, lookup.personName, lookup.exerciseName);
  };

  personInput.addEventListener("input", recalc);
  exerciseInput.addEventListener("input", recalc);
  downloadBtn.addEventListener("click", () => {
    if (!hasAnyBests(lookup.personName, lookup.exerciseName)) return;
    downloadBestCsv(lookup.personName, lookup.exerciseName);
  });
}

function renderPRHelper() {
  const root = document.getElementById("pr-helper");
  root.innerHTML = "";

  const collapsed = !!state.uiCollapsed.prHelper;
  if (collapsed) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `<h2 class="card-collapsible collapsed" data-collapse="prHelper" style="margin:0"><span class="collapse-caret">▸</span> PR helper</h2>`;
    root.appendChild(card);
    card.querySelector('[data-collapse="prHelper"]').addEventListener("click", () => {
      state.uiCollapsed.prHelper = false;
      saveUI();
      render();
    });
    return;
  }

  const prs = getAllPRs();
  const w = state.helperWeight;

  const quickPicksHtml = prs.length === 0 ? "" : `
    <div class="quick-picks">
      <div class="quick-picks-label">Or pick a known PR</div>
      <div class="quick-picks-row">
        ${prs.map(p => `
          <button class="quick-pick" data-pr-weight="${p.weight}">
            <span class="quick-pick-name">${escapeHtml(p.personName)} · ${escapeHtml(p.exerciseName)}</span>
            <span class="quick-pick-wt">${p.weight} kg</span>
          </button>
        `).join("")}
      </div>
    </div>
  `;

  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `
    <h2 class="card-collapsible" data-collapse="prHelper" style="margin-top:0"><span class="collapse-caret">▾</span> PR helper</h2>
    <div>
      <label for="helper-weight">Calculate percentages of</label>
      <input type="number" id="helper-weight" min="0" step="0.5" value="${w != null ? w : ""}" placeholder="Enter a weight (kg)" />
    </div>
    ${quickPicksHtml}
    <div class="helper-calc-root">${(w && w > 0) ? renderPRCalcHtml({ weight: w }) : ""}</div>
  `;
  root.appendChild(card);

  const input = card.querySelector("#helper-weight");
  const calcRoot = card.querySelector(".helper-calc-root");

  const recalc = () => {
    const v = parseFloat(input.value);
    state.helperWeight = !isNaN(v) && v > 0 ? v : null;
    calcRoot.innerHTML = state.helperWeight ? renderPRCalcHtml({ weight: state.helperWeight }) : "";
  };

  input.addEventListener("input", recalc);

  card.querySelectorAll("button.quick-pick").forEach(btn => {
    btn.addEventListener("click", () => {
      input.value = btn.getAttribute("data-pr-weight");
      recalc();
      input.focus();
    });
  });

  card.querySelector('[data-collapse="prHelper"]').addEventListener("click", () => {
    state.uiCollapsed.prHelper = true;
    saveUI();
    render();
  });
}

// ---------- Start session ----------

function renderStart() {
  const root = document.getElementById("start-session");
  root.innerHTML = "";
  if (getCurrentSession() || getViewingSession()) return;

  const card = document.createElement("div");
  card.className = "card";
  const s = state.setup;

  const countButtons = [1, 2, 3].map(n =>
    `<button class="count-btn ${s.count === n ? "active" : ""}" data-count="${n}">${n}</button>`
  ).join("");

  let namesHtml = "";
  if (s.count) {
    const inputs = [];
    for (let i = 0; i < s.count; i++) {
      const v = escapeHtml(s.names[i] || "");
      inputs.push(`
        <div>
          <label>Person ${i + 1}</label>
          <input type="text" class="name-input" data-idx="${i}" value="${v}" placeholder="Name" list="known-names" autocomplete="off" />
        </div>
      `);
    }
    namesHtml = `<div class="names-grid">${inputs.join("")}</div>`;
  }

  card.innerHTML = `
    <h2 style="margin-top:0">New session</h2>
    <div class="row session">
      <div>
        <label for="session-date">Date</label>
        <input type="date" id="session-date" value="${s.date}" />
      </div>
    </div>
    <div class="count-row">
      <label>How many people are exercising?</label>
      <div class="count-buttons">${countButtons}</div>
    </div>
    ${namesHtml}
    <div class="toolbar" style="margin-top:16px">
      <button id="start-btn" ${s.count ? "" : "disabled"}>Start session</button>
    </div>
  `;
  root.appendChild(card);

  card.querySelector("#session-date").addEventListener("change", e => {
    s.date = e.target.value || todayISO();
  });

  card.querySelectorAll(".count-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const n = parseInt(btn.getAttribute("data-count"), 10);
      s.count = n;
      const next = [];
      for (let i = 0; i < n; i++) next.push(s.names[i] || "");
      s.names = next;
      render();
    });
  });

  card.querySelectorAll(".name-input").forEach(inp => {
    inp.addEventListener("input", e => {
      const i = parseInt(e.target.getAttribute("data-idx"), 10);
      s.names[i] = e.target.value;
    });
    inp.addEventListener("keydown", e => {
      if (e.key !== "Enter") return;
      const i = parseInt(e.target.getAttribute("data-idx"), 10);
      const inputs = card.querySelectorAll(".name-input");
      if (i + 1 < inputs.length) inputs[i + 1].focus();
      else startSession();
    });
  });

  card.querySelector("#start-btn").addEventListener("click", startSession);
}

function startSession() {
  const s = state.setup;
  if (!s.count) return;
  const participants = [];
  for (let i = 0; i < s.count; i++) {
    const name = (s.names[i] || "").trim() || `Person ${i + 1}`;
    participants.push({ id: uid(), name, exercises: [] });
  }
  const session = { id: uid(), date: s.date || todayISO(), participants };
  state.sessions.push(session);
  state.currentId = session.id;
  state.setup = { date: todayISO(), count: null, names: [] };
  save();
  render();
}

// ---------- Session view (active or read-only viewing) ----------

function renderSession() {
  const root = document.getElementById("current-session");
  root.innerHTML = "";
  const viewing = getViewingSession();
  const active = getCurrentSession();
  const session = viewing || active;
  if (!session) return;
  const isActive = !!active && !viewing;

  const card = document.createElement("div");
  card.className = "card";

  const headerTag = isActive
    ? ` <span style="color:var(--muted);font-weight:400">(active)</span>`
    : "";
  const rightBtn = isActive
    ? `<button class="icon" id="finish-session">Finish</button>`
    : `
      <div style="display:flex;gap:6px">
        <button class="icon" id="back-btn">‹ Back</button>
        <button class="icon" id="resume-session" title="Convert this session back to active so you can keep logging sets">Resume</button>
      </div>
    `;

  const isEditingDate = state.editingSessionDateId === session.id;
  const dateDisplay = isEditingDate
    ? `<input type="date" class="session-date-input" value="${session.date}" />`
    : `<button class="session-date-btn" data-edit-date="${session.id}" title="Click to change the session date">${formatDate(session.date)}</button>`;

  card.innerHTML = `
    <div class="session-header">
      <div class="session-date">${dateDisplay}${headerTag}</div>
      ${rightBtn}
    </div>
    <div class="workout-grid" style="--cols:${session.participants.length}"></div>
  `;
  root.appendChild(card);

  const grid = card.querySelector(".workout-grid");
  session.participants.forEach(p => grid.appendChild(renderParticipantColumn(session, p, isActive)));

  if (isActive) {
    card.querySelector("#finish-session").addEventListener("click", () => {
      state.currentId = null;
      state.editingSetId = null;
      state.editingExerciseId = null;
      state.editingParticipantId = null;
      state.editingNotesId = null;
      state.editingSessionDateId = null;
      state.openPRCalcId = null;
      save();
      render();
    });
  } else {
    card.querySelector("#back-btn").addEventListener("click", () => {
      state.viewingId = null;
      state.editingSetId = null;
      state.editingExerciseId = null;
      state.editingParticipantId = null;
      state.editingNotesId = null;
      state.editingSessionDateId = null;
      state.openPRCalcId = null;
      saveUI();
      render();
    });
    card.querySelector("#resume-session").addEventListener("click", () => {
      if (state.currentId && state.currentId !== state.viewingId) {
        if (!confirm("You already have an active session. Resume this one and send the active one back to history?")) return;
      }
      state.currentId = state.viewingId;
      state.viewingId = null;
      state.editingSetId = null;
      state.editingExerciseId = null;
      state.editingParticipantId = null;
      state.editingNotesId = null;
      state.editingSessionDateId = null;
      state.openPRCalcId = null;
      saveUI();
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  // Date editing — works in both active and viewing modes
  const dateBtn = card.querySelector(`button[data-edit-date="${session.id}"]`);
  if (dateBtn) {
    dateBtn.addEventListener("click", () => {
      state.editingSessionDateId = session.id;
      render();
      const input = document.querySelector(".session-date-input");
      if (input) {
        input.focus();
        if (input.showPicker) {
          try { input.showPicker(); } catch {}
        }
      }
    });
  }
  const dateInput = card.querySelector(".session-date-input");
  if (dateInput) {
    dateInput.addEventListener("blur", () => {
      if (dateInput.value && dateInput.value !== session.date) {
        session.date = dateInput.value;
        save();
      }
      state.editingSessionDateId = null;
      render();
    });
    dateInput.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === "Escape") dateInput.blur();
    });
  }
}

function renderParticipantColumn(session, participant, isActive) {
  const col = document.createElement("div");
  col.className = "participant-col";

  const total = participantVolume(participant);
  const totalHtml = total > 0
    ? `<div class="participant-total" title="Sum of reps × weight across all sets">Total: ${fmt(total)} kg</div>`
    : "";

  const addExHtml = isActive ? `
    <div class="add-exercise">
      <label>Add exercise</label>
      <div class="add-exercise-row">
        <input type="text" class="new-ex-name" placeholder="e.g. Bench press" list="known-exercises" autocomplete="off" />
        <button class="add-ex-btn">Add</button>
      </div>
    </div>
  ` : "";

  const isRenamingP = state.editingParticipantId === participant.id;
  const nameHtml = isRenamingP
    ? `
      <div class="participant-rename-form">
        <input type="text" class="participant-rename-input" value="${escapeHtml(participant.name)}" list="known-names" autocomplete="off" />
        <button class="participant-rename-save">Save</button>
        <button class="secondary participant-rename-cancel">Cancel</button>
      </div>
    `
    : `<button class="participant-name-btn" data-rename-participant="${participant.id}" title="Click to rename — updates this name in every session">${escapeHtml(participant.name)}</button>`;

  col.innerHTML = `
    <div class="participant-header">
      ${nameHtml}
      ${totalHtml}
    </div>
    <div class="exercises-list"></div>
    ${addExHtml}
  `;

  const list = col.querySelector(".exercises-list");
  if (participant.exercises.length === 0) {
    list.innerHTML = `<div class="empty small">No exercises${isActive ? " yet" : ""}.</div>`;
  } else {
    participant.exercises.forEach(ex => {
      list.appendChild(renderExerciseCard(session, participant, ex, isActive));
    });
  }

  if (isActive) {
    const newExInput = col.querySelector(".new-ex-name");
    const addExBtn = col.querySelector(".add-ex-btn");
    const addEx = () => {
      const name = newExInput.value.trim();
      if (!name) { newExInput.focus(); return; }
      const newEx = { id: uid(), name, sets: [] };
      const prevEquip = findLastEquipment(name, participant.name);
      if (prevEquip) newEx.equipment = JSON.parse(JSON.stringify(prevEquip));
      participant.exercises.push(newEx);
      save();
      render();
      const cards = document.querySelectorAll(`[data-pid="${participant.id}"] .set-input-reps`);
      if (cards.length) cards[cards.length - 1].focus();
    };
    addExBtn.addEventListener("click", addEx);
    newExInput.addEventListener("keydown", e => { if (e.key === "Enter") addEx(); });
  }

  // Participant rename handlers
  const participantRenameBtn = col.querySelector(`button[data-rename-participant="${participant.id}"]`);
  if (participantRenameBtn) {
    participantRenameBtn.addEventListener("click", () => {
      state.editingParticipantId = participant.id;
      render();
      const input = document.querySelector(`[data-pid="${participant.id}"] .participant-rename-input`);
      if (input) { input.focus(); input.select(); }
    });
  }
  const renameInput = col.querySelector(".participant-rename-input");
  const renameSave = col.querySelector(".participant-rename-save");
  const renameCancel = col.querySelector(".participant-rename-cancel");
  if (renameInput && renameSave && renameCancel) {
    const commit = () => {
      const newName = renameInput.value.trim();
      if (!newName) { state.editingParticipantId = null; render(); return; }
      if (newName !== participant.name) {
        renameParticipant(participant.name, newName);
      }
      state.editingParticipantId = null;
      render();
    };
    renameSave.addEventListener("click", commit);
    renameCancel.addEventListener("click", () => {
      state.editingParticipantId = null;
      render();
    });
    renameInput.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); commit(); }
      if (e.key === "Escape") { state.editingParticipantId = null; render(); }
    });
  }

  col.setAttribute("data-pid", participant.id);
  return col;
}

function renderExerciseCard(session, participant, exercise, isActive) {
  const wrap = document.createElement("div");
  wrap.className = "exercise-card";

  const eq = exercise.equipment || { type: "weight" };
  const eqType = eq.type || "weight";
  const weightLabel = eqType === "dumbbell" ? "Weight/DB (kg)"
    : eqType === "bodyweight" ? "Added (kg)"
    : "Weight (kg)";
  const weightTip = eqType === "dumbbell"
    ? "Weight of one dumbbell — volume counts both when ×2"
    : eqType === "bodyweight"
      ? "Added weight only (belt/vest) — leave 0 for pure bodyweight"
      : WEIGHT_TOOLTIP;

  const lastSet = exercise.sets[exercise.sets.length - 1];
  const defReps = lastSet ? lastSet.reps : "";
  const defWeight = lastSet ? lastSet.weight : "";
  const defRir = lastSet && lastSet.rir != null ? lastSet.rir : "";

  const setsListHtml = exercise.sets.length === 0
    ? `<div class="empty small">No sets${isActive ? " yet" : ""}.</div>`
    : exercise.sets.map((s, i) => renderSetRowHtml(s, i)).join("");

  const total = exerciseVolume(exercise);
  const totalHtml = exercise.sets.length > 0
    ? `<div class="exercise-total">Total: ${fmt(total)} kg</div>`
    : "";

  const addSetHtml = isActive ? `
    <div class="add-set-form">
      <div>
        <label>Reps</label>
        <input type="number" class="set-input-reps" min="1" value="${defReps}" />
      </div>
      <div>
        <label title="${weightTip}">${weightLabel}</label>
        <input type="number" class="set-input-weight" min="0" step="0.5" value="${defWeight}" title="${weightTip}" />
      </div>
      <div>
        <label title="${RIR_TOOLTIP}">RIR</label>
        <input type="number" class="set-input-rir" min="0" max="10" value="${defRir}" title="${RIR_TOOLTIP}" placeholder="opt." />
      </div>
      <button class="add-set-btn">Add set</button>
    </div>
    ${eqType === "barbell" ? `<div class="plates-hint-root">${defWeight !== "" ? renderPlatesHintHtml(defWeight, resolveBar(exercise).kg) : `<div class="plates-hint warning">Enter a weight to see plate breakdown</div>`}</div>` : ""}
  ` : "";

  const isRenaming = state.editingExerciseId === exercise.id;
  const pr = getPR(exercise.name, participant.name);
  const prButton = pr
    ? ` <button class="pr-tag" data-toggle-pr-calc="${exercise.id}" title="Click for working weights at 50–100% of PR">(PR: ${pr.weight} kg)</button>`
    : "";
  const target = getTarget(participant.name, exercise.name);
  let targetTag = "";
  if (target) {
    const targetBest = findBestAtReps(participant.name, exercise.name, target.reps);
    const targetAchieved = targetBest && targetBest.weight >= target.weight - 1e-9;
    targetTag = ` <span class="target-tag ${targetAchieved ? "achieved" : ""}" title="${targetAchieved ? "Target achieved" : `Target — best so far: ${targetBest ? `${targetBest.weight} kg` : "none"} at ${target.reps}+ reps`}">Target: ${target.weight} kg × ${target.reps}</span>`;
  }
  let equipControls = "";
  if (isActive) {
    const types = [["weight", "Weight"], ["barbell", "Barbell"], ["dumbbell", "Dumbbell"], ["band", "Band"], ["bodyweight", "Bodyweight"]];
    const typeOpts = types.map(([v, l]) => `<option value="${v}" ${eqType === v ? "selected" : ""}>${l}</option>`).join("");
    equipControls = ` <select class="equip-select" title="Equipment type for this exercise">${typeOpts}</select>`;
    if (eqType === "barbell") {
      const cur = resolveBar(exercise);
      const barOpts = getBars().map(b =>
        `<option value="${b.id}" ${cur && b.id === cur.id ? "selected" : ""}>${escapeHtml(b.name)} (${b.kg} kg)</option>`
      ).join("");
      equipControls += ` <select class="bar-select" title="Which bar you're using — affects the plate breakdown">${barOpts}</select>`;
    } else if (eqType === "dumbbell") {
      const count = eq.dumbbellCount || 2;
      equipControls += [1, 2].map(n =>
        ` <button class="db-count-btn ${count === n ? "active" : ""}" data-db-count="${n}" title="Number of dumbbells">×${n}</button>`
      ).join("");
    }
  } else if (eqType !== "weight") {
    const label = eqType === "barbell" ? `Barbell · ${escapeHtml(resolveBar(exercise).name)}`
      : eqType === "dumbbell" ? `Dumbbell ×${eq.dumbbellCount || 2}`
      : eqType === "band" ? "Band" : "Bodyweight";
    equipControls = ` <span class="equip-tag">${label}</span>`;
  }
  const titleInner = isRenaming
    ? `
      <div class="rename-form">
        <input type="text" class="rename-input" value="${escapeHtml(exercise.name)}" list="known-exercises" autocomplete="off" />
        <button class="rename-save">Save</button>
        <button class="secondary rename-cancel">Cancel</button>
      </div>
    `
    : `
      <button class="exercise-name-btn" data-rename-ex="${exercise.id}" title="Click to rename — this updates the name for ${escapeHtml(participant.name)} in every session">
        ${escapeHtml(exercise.name)}
      </button>${prButton}${targetTag}${equipControls}
    `;
  const calcPanelHtml = (!isRenaming && pr && state.openPRCalcId === exercise.id)
    ? renderPRCalcHtml(pr)
    : "";

  const isEditingNotes = state.editingNotesId === exercise.id;
  const showNotesEditor = isActive || isEditingNotes;
  const hasNotes = exercise.notes && exercise.notes.trim();
  let notesHtml = "";
  if (showNotesEditor) {
    notesHtml = `
      <div class="exercise-notes">
        <label class="notes-label">Notes</label>
        <textarea class="notes-input" placeholder="Form cues, RPE, equipment, anything worth remembering…">${escapeHtml(exercise.notes || "")}</textarea>
      </div>
    `;
  } else if (hasNotes) {
    notesHtml = `
      <div class="exercise-notes read-only">
        <label class="notes-label">Notes</label>
        <button class="notes-display-btn" data-edit-notes="${exercise.id}" title="Click to edit">${escapeHtml(exercise.notes)}</button>
      </div>
    `;
  }

  wrap.innerHTML = `
    <div class="exercise-header">
      <div class="exercise-title">${titleInner}</div>
      <button class="danger small" data-del-ex="${exercise.id}" title="Remove exercise">×</button>
    </div>
    ${calcPanelHtml}
    <div class="sets-list">${setsListHtml}</div>
    ${totalHtml}
    ${notesHtml}
    ${addSetHtml}
  `;

  wireSetRowHandlers(wrap, exercise);

  if (isActive) {
    const repsInput = wrap.querySelector(".set-input-reps");
    const weightInput = wrap.querySelector(".set-input-weight");
    const rirInput = wrap.querySelector(".set-input-rir");

    const addSet = () => {
      const reps = parseInt(repsInput.value, 10);
      let weight = parseFloat(weightInput.value);
      if (isNaN(weight) && (eqType === "band" || eqType === "bodyweight")) weight = 0;
      const rirRaw = rirInput.value;
      if (!reps || isNaN(weight)) {
        alert("Enter reps and weight.");
        return;
      }
      const set = { id: uid(), reps, weight };
      if (rirRaw !== "" && !isNaN(parseInt(rirRaw, 10))) set.rir = parseInt(rirRaw, 10);
      exercise.sets.push(set);
      save();
      render();
      const sel = `[data-pid="${participant.id}"] [data-exid="${exercise.id}"] .set-input-reps`;
      const next = document.querySelector(sel);
      if (next) next.focus();
    };
    wrap.querySelector(".add-set-btn").addEventListener("click", addSet);
    [repsInput, weightInput, rirInput].forEach(inp => {
      inp.addEventListener("keydown", e => { if (e.key === "Enter") addSet(); });
    });

    // Live plate hint while typing the weight
    weightInput.addEventListener("input", () => {
      const hintRoot = wrap.querySelector(".plates-hint-root");
      if (!hintRoot) return;
      const w = parseFloat(weightInput.value);
      hintRoot.innerHTML = (!isNaN(w) && w > 0)
        ? renderPlatesHintHtml(w, resolveBar(exercise).kg)
        : `<div class="plates-hint warning">Enter a weight to see plate breakdown</div>`;
    });
  }

  // Notes
  const notesInput = wrap.querySelector(".notes-input");
  if (notesInput) {
    notesInput.addEventListener("blur", () => {
      const newNotes = notesInput.value;
      const changed = newNotes !== (exercise.notes || "");
      if (changed) {
        exercise.notes = newNotes;
        save();
      }
      if (state.editingNotesId === exercise.id) {
        state.editingNotesId = null;
        render();
      }
    });
    notesInput.addEventListener("keydown", e => {
      if (e.key === "Escape") {
        notesInput.value = exercise.notes || "";
        notesInput.blur();
      }
    });
  }
  const notesEditBtn = wrap.querySelector(`button[data-edit-notes="${exercise.id}"]`);
  if (notesEditBtn) {
    notesEditBtn.addEventListener("click", () => {
      state.editingNotesId = exercise.id;
      render();
      const ta = document.querySelector(`[data-exid="${exercise.id}"] .notes-input`);
      if (ta) {
        ta.focus();
        const len = ta.value.length;
        ta.setSelectionRange(len, len);
      }
    });
  }

  // Equipment controls. These re-render the card, so first capture any
  // typed-but-unsaved values in the add-set inputs and restore them after,
  // then refresh the plate hint against the restored weight.
  const getVal = sel => { const el = wrap.querySelector(sel); return el ? el.value : ""; };
  const saveEquipAndRender = () => {
    const vals = {
      reps: getVal(".set-input-reps"),
      weight: getVal(".set-input-weight"),
      rir: getVal(".set-input-rir"),
    };
    save();
    render();
    const cardEl = document.querySelector(`[data-exid="${exercise.id}"]`);
    if (!cardEl) return;
    const r = cardEl.querySelector(".set-input-reps");
    const w = cardEl.querySelector(".set-input-weight");
    const rr = cardEl.querySelector(".set-input-rir");
    if (r) r.value = vals.reps;
    if (w) w.value = vals.weight;
    if (rr) rr.value = vals.rir;
    const hintRoot = cardEl.querySelector(".plates-hint-root");
    if (hintRoot) {
      const wv = parseFloat(vals.weight);
      hintRoot.innerHTML = (!isNaN(wv) && wv > 0)
        ? renderPlatesHintHtml(wv, resolveBar(exercise).kg)
        : `<div class="plates-hint warning">Enter a weight to see plate breakdown</div>`;
    }
  };
  const equipSelect = wrap.querySelector(".equip-select");
  if (equipSelect) {
    equipSelect.addEventListener("change", () => {
      const t = equipSelect.value;
      if (t === "weight") delete exercise.equipment;
      else if (t === "barbell") exercise.equipment = { type: "barbell", barId: resolveBar(exercise).id || getDefaultBar().id };
      else if (t === "dumbbell") exercise.equipment = { type: "dumbbell", dumbbellCount: eq.dumbbellCount === 1 ? 1 : 2 };
      else exercise.equipment = { type: t };
      saveEquipAndRender();
    });
  }
  const barSelect = wrap.querySelector(".bar-select");
  if (barSelect) {
    barSelect.addEventListener("change", () => {
      exercise.equipment = { type: "barbell", barId: barSelect.value };
      saveEquipAndRender();
    });
  }
  wrap.querySelectorAll(".db-count-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      exercise.equipment = { type: "dumbbell", dumbbellCount: parseInt(btn.getAttribute("data-db-count"), 10) };
      saveEquipAndRender();
    });
  });

  wrap.querySelector(`button[data-del-ex="${exercise.id}"]`).addEventListener("click", () => {
    if (exercise.sets.length && !confirm(`Remove "${exercise.name}" and its ${exercise.sets.length} set(s)?`)) return;
    participant.exercises = participant.exercises.filter(e => e.id !== exercise.id);
    save();
    render();
  });

  // PR calc toggle
  const prBtn = wrap.querySelector(`button[data-toggle-pr-calc="${exercise.id}"]`);
  if (prBtn) {
    prBtn.addEventListener("click", e => {
      e.stopPropagation();
      state.openPRCalcId = state.openPRCalcId === exercise.id ? null : exercise.id;
      render();
    });
  }

  // Rename handlers
  const renameBtn = wrap.querySelector(`button[data-rename-ex="${exercise.id}"]`);
  if (renameBtn) {
    renameBtn.addEventListener("click", () => {
      state.editingExerciseId = exercise.id;
      render();
      const input = document.querySelector(`[data-exid="${exercise.id}"] .rename-input`);
      if (input) { input.focus(); input.select(); }
    });
  }
  const renameInput = wrap.querySelector(".rename-input");
  const renameSave = wrap.querySelector(".rename-save");
  const renameCancel = wrap.querySelector(".rename-cancel");
  if (renameInput && renameSave && renameCancel) {
    const commit = () => {
      const newName = renameInput.value.trim();
      if (!newName) { state.editingExerciseId = null; render(); return; }
      if (newName.toLowerCase() !== exercise.name.trim().toLowerCase() || newName !== exercise.name) {
        renameExercise(participant.name, exercise.name, newName);
      }
      state.editingExerciseId = null;
      render();
    };
    renameSave.addEventListener("click", commit);
    renameCancel.addEventListener("click", () => {
      state.editingExerciseId = null;
      render();
    });
    renameInput.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); commit(); }
      if (e.key === "Escape") { state.editingExerciseId = null; render(); }
    });
  }

  wrap.setAttribute("data-exid", exercise.id);
  return wrap;
}

// ---------- Set row (display + edit) ----------

function renderSetRowHtml(s, i) {
  if (state.editingSetId === s.id) {
    const rirVal = s.rir != null ? s.rir : "";
    return `
      <div class="set-row editing" data-set-id="${s.id}">
        <span class="set-num">${i + 1}.</span>
        <div class="set-edit-form">
          <input type="number" class="edit-reps" min="1" value="${s.reps}" placeholder="reps" />
          <input type="number" class="edit-weight" min="0" step="0.5" value="${s.weight}" placeholder="kg" title="${WEIGHT_TOOLTIP}" />
          <input type="number" class="edit-rir" min="0" max="10" value="${rirVal}" placeholder="RIR" title="${RIR_TOOLTIP}" />
          <button class="save-edit" data-save-set="${s.id}">Save</button>
          <button class="secondary cancel-edit">Cancel</button>
        </div>
      </div>
    `;
  }
  return `
    <div class="set-row" data-set-id="${s.id}">
      <span class="set-num">${i + 1}.</span>
      <button class="set-summary-btn" data-edit-set="${s.id}" title="Click to edit">
        ${s.reps} × ${s.weight} kg${s.rir != null && s.rir !== "" ? ` <span class="rir-tag">RIR ${s.rir}</span>` : ""}
      </button>
      <button class="danger small" data-del-set="${s.id}" title="Remove set">×</button>
    </div>
  `;
}

function wireSetRowHandlers(wrap, exercise) {
  wrap.querySelectorAll("button[data-edit-set]").forEach(btn => {
    btn.addEventListener("click", () => {
      state.editingSetId = btn.getAttribute("data-edit-set");
      render();
      const form = document.querySelector(`.set-row.editing[data-set-id="${state.editingSetId}"]`);
      if (form) form.querySelector(".edit-reps").focus();
    });
  });

  wrap.querySelectorAll("button[data-del-set]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-del-set");
      exercise.sets = exercise.sets.filter(s => s.id !== id);
      if (state.editingSetId === id) state.editingSetId = null;
      save();
      render();
    });
  });

  wrap.querySelectorAll("button[data-save-set]").forEach(btn => {
    const row = btn.closest(".set-row.editing");
    const saveFn = () => {
      const id = btn.getAttribute("data-save-set");
      const set = exercise.sets.find(s => s.id === id);
      if (!set) return;
      const reps = parseInt(row.querySelector(".edit-reps").value, 10);
      const weight = parseFloat(row.querySelector(".edit-weight").value);
      const rirRaw = row.querySelector(".edit-rir").value;
      if (!reps || isNaN(weight)) {
        alert("Enter reps and weight.");
        return;
      }
      set.reps = reps;
      set.weight = weight;
      if (rirRaw === "") delete set.rir;
      else if (!isNaN(parseInt(rirRaw, 10))) set.rir = parseInt(rirRaw, 10);
      state.editingSetId = null;
      state.editingExerciseId = null;
      state.editingParticipantId = null;
      state.editingNotesId = null;
      state.editingSessionDateId = null;
      state.openPRCalcId = null;
      save();
      render();
    };
    btn.addEventListener("click", saveFn);
    row.querySelectorAll("input").forEach(inp => {
      inp.addEventListener("keydown", e => {
        if (e.key === "Enter") saveFn();
        if (e.key === "Escape") { state.editingSetId = null; render(); }
      });
    });
  });

  wrap.querySelectorAll("button.cancel-edit").forEach(btn => {
    btn.addEventListener("click", () => {
      state.editingSetId = null;
      render();
    });
  });
}

// ---------- History (compact overview) ----------

function renderHistory() {
  const root = document.getElementById("history");
  root.innerHTML = "";
  if (getViewingSession()) return;

  const past = state.sessions
    .filter(s => s.id !== state.currentId)
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date));

  if (past.length === 0) {
    root.innerHTML = `<div class="empty">No past sessions yet.</div>`;
    return;
  }

  past.forEach(session => {
    const card = document.createElement("div");
    card.className = "card";

    const sessionTotal = session.participants.reduce((sum, p) => sum + participantVolume(p), 0);

    const body = session.participants.map(p => {
      const total = participantVolume(p);
      const totalTag = total > 0 ? ` <span class="muted-tag">· ${fmt(total)} kg total</span>` : "";
      return `
        <div class="history-participant">
          <div class="history-name">${escapeHtml(p.name)}${totalTag}</div>
          ${p.exercises.length === 0
            ? `<div class="empty small" style="text-align:left">No exercises.</div>`
            : p.exercises.map(ex => `
                <div class="history-exercise compact">
                  <span class="exercise-title">${escapeHtml(ex.name)}${prHtml(ex.name, p.name)}</span>
                  <span class="muted-tag">${fmt(exerciseVolume(ex))} kg</span>
                </div>
              `).join("")}
        </div>
      `;
    }).join("");

    const sessionTotalTag = sessionTotal > 0
      ? ` <span class="muted-tag">· ${fmt(sessionTotal)} kg total</span>`
      : "";

    card.innerHTML = `
      <div class="session-header">
        <div class="session-date">${formatDate(session.date)} <span style="color:var(--muted);font-weight:400">· ${session.participants.length} ${session.participants.length === 1 ? "person" : "people"}</span>${sessionTotalTag}</div>
        <div style="display:flex;gap:8px">
          <button class="icon" data-open="${session.id}">Open</button>
          <button class="danger" data-del-session="${session.id}">Delete</button>
        </div>
      </div>
      ${body}
    `;
    root.appendChild(card);
  });

  root.querySelectorAll("button[data-open]").forEach(btn => {
    btn.addEventListener("click", () => {
      state.viewingId = btn.getAttribute("data-open");
      state.editingSetId = null;
      state.editingExerciseId = null;
      state.editingParticipantId = null;
      state.editingNotesId = null;
      state.editingSessionDateId = null;
      state.openPRCalcId = null;
      saveUI();
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
  root.querySelectorAll("button[data-del-session]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-del-session");
      if (!confirm("Delete this session?")) return;
      state.sessions = state.sessions.filter(s => s.id !== id);
      save();
      render();
    });
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

load();
render();
