import type {
  BestTable, Exercise, ExerciseKind, ExerciseSummary, ImportResult, Inventory, InventoryList, PR, Person,
  Session, SetInput, Target,
} from "./types";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const data = await res.json();
      if (typeof data.detail === "string") message = data.detail;
      else if (Array.isArray(data.detail)) message = data.detail.map((d: { msg: string }) => d.msg).join("\n");
    } catch { /* not JSON */ }
    throw new ApiError(res.status, message);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

const get = <T>(path: string) => request<T>("GET", path);
const post = <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {});
const put = <T>(path: string, body: unknown) => request<T>("PUT", path, body);
const patch = <T>(path: string, body: unknown) => request<T>("PATCH", path, body);
const del = <T>(path: string) => request<T>("DELETE", path);

export const api = {
  people: () => get<Person[]>("/people"),
  renamePerson: (id: number, name: string) => patch<Person>(`/people/${id}`, { name }),
  mergePerson: (id: number, intoId: number) => post<Person>(`/people/${id}/merge`, { into_id: intoId }),
  deletePerson: (id: number) => del<void>(`/people/${id}`),

  exercises: () => get<Exercise[]>("/exercises"),
  exerciseSummary: () => get<ExerciseSummary[]>("/exercises/summary"),
  createExercise: (name: string, kind: ExerciseKind) => post<Exercise>("/exercises", { name, kind }),
  renameExercise: (id: number, name: string) => patch<Exercise>(`/exercises/${id}`, { name }),
  mergeExercise: (id: number, intoId: number) => post<Exercise>(`/exercises/${id}/merge`, { into_id: intoId }),
  deleteExercise: (id: number) => del<void>(`/exercises/${id}`),

  sessions: () => get<Session[]>("/sessions"),
  startSession: (date: string, people: string[]) => post<Session>("/sessions", { date, people }),
  updateSession: (id: number, body: { date?: string; status?: "active" | "finished" }) =>
    patch<Session>(`/sessions/${id}`, body),
  deleteSession: (id: number) => del<void>(`/sessions/${id}`),

  addParticipant: (sessionId: number, name: string) => post<Session>(`/sessions/${sessionId}/participants`, { name }),
  reassignParticipant: (id: number, name: string) => patch<Session>(`/participants/${id}`, { name }),
  removeParticipant: (id: number) => del<Session>(`/participants/${id}`),

  addEntry: (participantId: number, body: { exercise_id?: number; name?: string }) =>
    post<Session>(`/participants/${participantId}/entries`, body),
  updateEntry: (id: number, body: Record<string, unknown>) => patch<Session>(`/entries/${id}`, body),
  deleteEntry: (id: number) => del<Session>(`/entries/${id}`),

  addSet: (entryId: number, body: SetInput) => post<Session>(`/entries/${entryId}/sets`, body),
  replaceSet: (id: number, body: SetInput) => put<Session>(`/sets/${id}`, body),
  deleteSet: (id: number) => del<Session>(`/sets/${id}`),
  moveSet: (id: number, direction: "up" | "down") => post<Session>(`/sets/${id}/move`, { direction }),

  prs: () => get<PR[]>("/stats/prs"),
  bestTable: (personId: number, exerciseId: number) =>
    get<BestTable>(`/stats/best?person_id=${personId}&exercise_id=${exerciseId}`),

  targets: () => get<Target[]>("/targets"),
  setTarget: (personId: number, exerciseId: number, weightKg: number, reps: number) =>
    put<Target>("/targets", { person_id: personId, exercise_id: exerciseId, weight_kg: weightKg, reps }),
  deleteTarget: (id: number) => del<void>(`/targets/${id}`),

  inventory: () => get<Inventory>("/inventory"),
  addInventory: (list: InventoryList, body: object) => post<Inventory>(`/inventory/${list}`, body),
  updateInventory: (list: InventoryList, id: number, body: object) => put<Inventory>(`/inventory/${list}/${id}`, body),
  removeInventory: (list: InventoryList, id: number) => del<Inventory>(`/inventory/${list}/${id}`),

  exportAll: () => get<unknown>("/export"),
  importAll: (payload: unknown, mode: "replace" | "merge") => post<ImportResult>(`/import?mode=${mode}`, payload),
};
