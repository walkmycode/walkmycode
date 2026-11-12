/**
 * Where lessons, courses, the student profile and everything beside them
 * (conversations, the notebook, recall cards) are kept.
 * - WalkMyCode Lite (a Claude artifact): the viewer's own private space in its
 *   database (data/users/<id>/...), which follows them to any device.
 * - WalkMyCode (the app): files on this computer, in .walkmycode/learn/
 *   (src/lib/learnStore.ts through /api/learn/store), so work survives a
 *   reload, a restart and a change of browser. Lessons an earlier version
 *   kept in this browser are copied over the first time.
 * - Anywhere else, or when the server cannot be reached: this browser's storage.
 */
import { LITE } from "@/lib/adapters/target";
import { getDb, getUserId, type CollRef, type DocRef } from "./claude";
import { DEFAULT_PROFILE, type Course, type Lesson, type Profile } from "./types";

export type Store = {
  kind: "account" | "browser" | "computer";
  /** The folder the work is kept in, when it is on this computer. */
  where?: string;
  /** How many lessons were copied from this browser's storage on opening (once). */
  imported?: number;
  /** Everything kept beside lessons: "chat-<lessonId>", "notebook", "cards". Null when nothing was saved. */
  loadExtra<T>(key: string): Promise<T | null>;
  saveExtra(key: string, value: object): Promise<void>;
  listLessons(): Promise<Lesson[]>;
  saveLesson(l: Lesson): Promise<void>;
  deleteLesson(id: string): Promise<void>;
  listCourses(): Promise<Course[]>;
  saveCourse(c: Course): Promise<void>;
  getProfile(): Promise<Profile>;
  saveProfile(p: Profile): Promise<void>;
};

const LS = "lecture-hall:";
const ls = {
  get<T>(k: string, fallback: T): T {
    try {
      const v = localStorage.getItem(LS + k);
      return v ? (JSON.parse(v) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(LS + k, JSON.stringify(v));
    } catch {
      /* storage full or blocked: the lesson still works for this visit */
    }
  },
};

function browserStore(): Store {
  return {
    kind: "browser",
    async listLessons() {
      return ls.get<Lesson[]>("lessons", []);
    },
    async saveLesson(l) {
      const all = ls.get<Lesson[]>("lessons", []).filter((x) => x.id !== l.id);
      ls.set("lessons", [...all, l]);
    },
    async deleteLesson(id) {
      ls.set("lessons", ls.get<Lesson[]>("lessons", []).filter((x) => x.id !== id));
    },
    async listCourses() {
      return ls.get<Course[]>("courses", []);
    },
    async saveCourse(c) {
      ls.set("courses", [...ls.get<Course[]>("courses", []).filter((x) => x.id !== c.id), c]);
    },
    async getProfile() {
      return { ...DEFAULT_PROFILE, ...ls.get<Partial<Profile>>("profile", {}) };
    },
    async saveProfile(p) {
      ls.set("profile", p);
    },
    async loadExtra<T>(key: string) {
      return ls.get<T | null>(`extra:${key}`, null);
    },
    async saveExtra(key, value) {
      ls.set(`extra:${key}`, value);
    },
  };
}

const API = "/api/learn/store";

/** One write at a time per document, the newest last: a slow save can never land on top of a newer one. */
function queue() {
  const pending = new Map<string, Promise<void>>();
  return (key: string, write: () => Promise<void>) => {
    const next = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(write);
    pending.set(key, next);
    return next;
  };
}

async function api(method: "GET" | "PUT" | "DELETE", doc: string | null, data?: unknown): Promise<unknown> {
  const url = method === "PUT" || doc === null ? API : `${API}?doc=${encodeURIComponent(doc)}`;
  const res = await fetch(url, {
    method,
    cache: "no-store",
    ...(method === "PUT" ? { headers: { "content-type": "application/json" }, body: JSON.stringify({ doc, data }) } : {}),
  });
  if (!res.ok) throw new Error(`The Learn store answered ${res.status}.`);
  return res.json();
}

type Everything = { lessons: Lesson[]; courses: Course[]; profile: Partial<Profile> | null; where?: string };

/** The app's own store: files in .walkmycode/learn/ on this computer. Throws when the server has no such route. */
async function computerStore(): Promise<Store> {
  const first = (await api("GET", null)) as Everything;
  if (!Array.isArray(first.lessons) || !Array.isArray(first.courses)) throw new Error("Not the Learn store.");
  const put = queue();
  // The opening read serves the first listing; any write after it means the next listing asks again.
  let opened: Everything | null = first;
  const save = (doc: string, data: unknown) => {
    opened = null;
    return put(doc, async () => void (await api("PUT", doc, data)));
  };
  let imported = 0;
  // An earlier version kept everything in this browser: copy it over once, and leave the browser's copy alone.
  if (!first.lessons.length && !first.courses.length && !first.profile) {
    const old = browserStore();
    const [lessons, courses] = await Promise.all([old.listLessons(), old.listCourses()]);
    if (lessons.length) {
      await Promise.all([...lessons.map((l) => save("lessons/" + l.id, l)), ...courses.map((c) => save("courses/" + c.id, c)), save("profile", await old.getProfile())]);
      imported = lessons.length;
    }
  }
  const everything = async () => opened ?? ((await api("GET", null)) as Everything);
  return {
    kind: "computer",
    ...(first.where ? { where: first.where } : {}),
    ...(imported ? { imported } : {}),
    listLessons: async () => (await everything()).lessons,
    saveLesson: (l) => save(`lessons/${l.id}`, l),
    deleteLesson: async (id) => {
      opened = null;
      await api("DELETE", "lessons/" + id);
    },
    listCourses: async () => (await everything()).courses,
    saveCourse: (c) => save(`courses/${c.id}`, c),
    getProfile: async () => ({ ...DEFAULT_PROFILE, ...((await everything()).profile ?? {}) }),
    saveProfile: (p) => save("profile", p),
    loadExtra: async <T,>(key: string) => ((await api("GET", `extras/${key}`)) as { data: T | null }).data ?? null,
    saveExtra: (key, value) => save(`extras/${key}`, value),
  };
}

function accountStore(profile: DocRef, lessons: CollRef, courses: CollRef): Store {
  // One write at a time per document: queue saves of the same lesson.
  const pending = new Map<string, Promise<void>>();
  return {
    kind: "account",
    async listLessons() {
      const snap = await lessons.get();
      return snap.docs.filter((d) => d.exists).map((d) => d.data() as unknown as Lesson);
    },
    saveLesson(l) {
      const prev = pending.get(l.id) ?? Promise.resolve();
      const next = prev.catch(() => {}).then(() => lessons.doc(l.id).set(l as unknown as Record<string, unknown>));
      pending.set(l.id, next);
      return next;
    },
    async deleteLesson(id) {
      await lessons.doc(id).delete();
    },
    async listCourses() {
      const snap = await courses.get();
      return snap.docs.filter((d) => d.exists).map((d) => d.data() as unknown as Course);
    },
    async saveCourse(c) {
      await courses.doc(c.id).set(c as unknown as Record<string, unknown>);
    },
    async getProfile() {
      const s = await profile.get();
      return { ...DEFAULT_PROFILE, ...((s.exists ? s.data() : {}) as Partial<Profile>) };
    },
    async saveProfile(p) {
      await profile.set(p as unknown as Record<string, unknown>);
    },
    async loadExtra<T>(key: string) {
      const s = await profile.collection("extras").doc(key).get();
      return s.exists ? ((s.data() as unknown as T) ?? null) : null;
    },
    saveExtra(key, value) {
      const prev = pending.get(`extra:${key}`) ?? Promise.resolve();
      const next = prev.catch(() => {}).then(() => profile.collection("extras").doc(key).set(value as Record<string, unknown>));
      pending.set(`extra:${key}`, next);
      return next;
    },
  };
}

export async function openStore(): Promise<Store> {
  const [db, uid] = await Promise.all([getDb(), getUserId()]);
  if (!db || !uid) {
    // The app keeps the work on this computer; Lite outside Claude has only the browser.
    if (LITE) return browserStore();
    try {
      return await computerStore();
    } catch {
      return browserStore();
    }
  }
  try {
    const profile = db.doc(`data/users/${uid}/profile`);
    const store = accountStore(profile, profile.collection("lessons"), profile.collection("courses"));
    await store.getProfile(); // proves the space is reachable
    return store;
  } catch {
    return browserStore();
  }
}

export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
export const now = () => Date.now();
