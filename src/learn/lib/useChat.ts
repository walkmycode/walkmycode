"use client";
/**
 * The conversation beside a lesson, as the page holds it: loaded from the
 * store when the lesson opens, saved as it changes (a moment after the last
 * change, and at once when the lesson is left), and one answer at a time from
 * the professor, streamed into the last message.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { chatTurns, emptyChat, fromHands, KEEP, type ActionId, type AskContext, type Chat, type ChatMsg } from "./chat";
import { sampleMessage, type Sample } from "./claude";
import { newId, type Store } from "./store";
import type { Lesson, Profile } from "./types";

export type ChatApi = {
  chat: Chat;
  /** False until the saved conversation has been read. */
  ready: boolean;
  busy: boolean;
  /** Ask the professor. Returns false when nothing was sent (no AI, empty text, an answer still arriving). */
  send: (text: string, action?: ActionId) => boolean;
  /** Add something the professor shows without being asked (the course's solution). */
  say: (text: string, asked: string) => void;
  stop: () => void;
  /** Ask the last question again (after an error, or for another answer). */
  retry: () => void;
  clear: () => void;
  setDraft: (text: string) => void;
};

type Options = {
  lesson: Lesson;
  profile: Profile;
  sample: Sample | null;
  store: Store | null;
  /** The board on screen and the student's work on it, read when a question is sent. */
  context: () => AskContext;
  /** A finished answer, to be read aloud. */
  onAnswer?: (text: string) => void;
};

export function useChat({ lesson, profile, sample, store, context, onAnswer }: Options): ChatApi {
  const [chat, setChat] = useState<Chat>(() => emptyChat(lesson.id));
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const live = useRef(chat);
  const ctl = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  const latest = useRef({ lesson, profile, sample, store, context, onAnswer });
  useEffect(() => {
    latest.current = { lesson, profile, sample, store, context, onAnswer };
  });

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!dirty.current) return;
    dirty.current = false;
    // An answer still arriving is saved as far as it has come; a reload shows it as stopped.
    void latest.current.store?.saveExtra(`chat-${live.current.lessonId}`, live.current).catch(() => {});
  }, []);

  const update = useCallback(
    (change: (c: Chat) => Chat, save: "soon" | "now" | "no" = "soon") => {
      const next = change(live.current);
      live.current = next;
      setChat(next);
      if (save === "no") return;
      dirty.current = true;
      if (save === "now") return flush();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, 600);
    },
    [flush],
  );

  // Open the lesson's conversation; one from before conversations were kept is made from its raised hands.
  useEffect(() => {
    let on = true;
    (async () => {
      const saved = await store?.loadExtra<Chat>(`chat-${lesson.id}`).catch(() => null);
      if (!on) return;
      const msgs = Array.isArray(saved?.msgs) ? saved.msgs : fromHands(latest.current.lesson.hands);
      // An answer cut off by a reload is kept as far as it came.
      const tidy = msgs.map((m) => (m.role === "prof" && !m.text.trim() && !m.err ? { ...m, err: "This answer was interrupted." } : m));
      live.current = { lessonId: lesson.id, msgs: tidy, draft: saved?.draft ?? "", updatedAt: saved?.updatedAt ?? 0 };
      setChat(live.current);
      setReady(true);
    })();
    return () => {
      on = false;
    };
  }, [store, lesson.id]);

  // Leaving the lesson stops the answer and saves what there is.
  useEffect(
    () => () => {
      ctl.current?.abort();
      flush();
    },
    [flush],
  );
  // Closing the tab mid-thought keeps it too.
  useEffect(() => {
    const onHide = () => flush();
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [flush]);

  const answer = useCallback(
    async (answerId: string) => {
      const { lesson: l, profile: p, sample: ai, context: ctx, onAnswer: done } = latest.current;
      if (!ai) return;
      const turns = chatTurns(l, p, live.current.msgs.filter((m) => m.id !== answerId), ctx());
      const patch = (edit: Partial<ChatMsg>, save: "soon" | "now" | "no") =>
        update((c) => ({ ...c, updatedAt: Date.now(), msgs: c.msgs.map((m) => (m.id === answerId ? { ...m, ...edit } : m)) }), save);
      if (!turns.length) return patch({ err: "There is no question to answer." }, "now");
      const abort = new AbortController();
      ctl.current = abort;
      setBusy(true);
      try {
        const { text } = await ai(turns, { signal: abort.signal, cache: false, onText: ({ text: soFar }) => patch({ text: soFar }, "no") });
        patch({ text }, "now");
        done?.(text);
      } catch (e) {
        const partial = (e as { text?: string }).text ?? live.current.msgs.find((m) => m.id === answerId)?.text ?? "";
        const said = sampleMessage(e);
        // Stopped by the student: what arrived stays, with no error.
        patch(said ? { text: partial, err: said } : { text: partial, stopped: true }, "now");
      } finally {
        if (ctl.current === abort) ctl.current = null;
        setBusy(false);
      }
    },
    [update],
  );

  const send = useCallback(
    (text: string, action?: ActionId) => {
      const q = text.trim();
      if (!q || !latest.current.sample || ctl.current) return false;
      const at = Date.now();
      const board = latest.current.context().board;
      const answerId = newId();
      update(
        (c) => ({
          ...c,
          draft: "",
          updatedAt: at,
          msgs: [...c.msgs, { id: newId(), role: "you" as const, text: q, at, board, ...(action ? { action } : {}) }, { id: answerId, role: "prof" as const, text: "", at, board }].slice(-KEEP),
        }),
        "now",
      );
      void answer(answerId);
      return true;
    },
    [answer, update],
  );

  const say = useCallback(
    (text: string, asked: string) => {
      const at = Date.now();
      const board = latest.current.context().board;
      update((c) => ({ ...c, updatedAt: at, msgs: [...c.msgs, { id: newId(), role: "you" as const, text: asked, at, board }, { id: newId(), role: "prof" as const, text, at, board }].slice(-KEEP) }), "now");
    },
    [update],
  );

  const stop = useCallback(() => ctl.current?.abort(), []);

  const retry = useCallback(() => {
    if (ctl.current || !latest.current.sample) return;
    const msgs = live.current.msgs;
    const last = msgs.at(-1);
    if (!last || last.role !== "prof" || msgs.at(-2)?.role !== "you") return;
    const answerId = newId();
    update((c) => ({ ...c, updatedAt: Date.now(), msgs: [...c.msgs.slice(0, -1), { id: answerId, role: "prof" as const, text: "", at: Date.now(), board: last.board }] }), "now");
    void answer(answerId);
  }, [answer, update]);

  const clear = useCallback(() => {
    ctl.current?.abort();
    update((c) => ({ ...c, msgs: [], draft: "", updatedAt: Date.now() }), "now");
  }, [update]);

  const setDraft = useCallback((text: string) => update((c) => ({ ...c, draft: text })), [update]);

  return { chat, ready, busy, send, say, stop, retry, clear, setDraft };
}
