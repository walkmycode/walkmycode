"use client";
// "Where does this point?" (docs/SERVICES.md §13). The map asks once about each
// base-URL setting the code reads that nothing in the repo gives a value, and
// lists the app services to choose from, or a separate backend whose code isn't
// here. It also asks "Whose address is this?" about a public address the code
// calls when one app's routes answer most of its requests and nothing in the
// repos says whose it is: "Is https://api.example.com your backend?". The answer
// is saved with the workspace and the map is drawn again with it; the arrows it
// settles are solid but say "you told WalkMyCode", never that the code proves them.
// Details can change or clear an answer later.
import { memo, useState } from "react";
import type { CodeMap, PublicHost, ServiceDef, UnresolvedBase } from "@/analyzer/types";
import { answer, answerFor, dismissRemap, useRemap } from "@/lib/answers";
import { useWorkspace } from "@/lib/store";

type Open = (path: string, start: number, end?: number) => void;

function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
}

const nameOf = (map: CodeMap, id: string) => map.services.find((s) => s.id === id)?.name ?? id;

/** "frontend", "web and orders", or "The code" when no service reads it. */
function readers(map: CodeMap, b: UnresolvedBase): string {
  const names = b.services.map((id) => nameOf(map, id));
  return names.length ? names.join(" and ") : "The code";
}

/** The services to choose from: the one its name suggests first, the ones that read it last. */
function choices(map: CodeMap, b: UnresolvedBase): ServiceDef[] {
  const apps = map.services.filter((s) => s.kind === "app");
  const rank = (s: ServiceDef) => (s.id === b.guess ? 0 : b.services.includes(s.id) ? 2 : 1);
  return apps.map((s, i) => ({ s, i })).sort((x, y) => rank(x.s) - rank(y.s) || x.i - y.i).map((x) => x.s);
}

// Questions put off with "Not now", for this visit: workspace id | setting (or address).
const later = new Set<string>();

/** The answer that draws a setting's requests to its own stand-in. */
const ELSEWHERE = "A separate backend I don’t have here";

/** Addresses worth asking about: one app's routes answer most of their requests, and nothing in the repos says whose they are. */
function askable(map: CodeMap, h: PublicHost): boolean {
  return !!h.guess && !h.config && h.calls > 0 && map.services.some((s) => s.id === h.guess && s.kind === "app");
}

/** The address question: "Is https://api.example.com your backend?", the guess first. */
function HostQuestion({ map, h, rest, onLater }: { map: CodeMap; h: PublicHost; rest: number; onLater: () => void }) {
  const oneApp = map.system.kind !== "services";
  const apps = map.services.filter((s) => s.kind === "app");
  const opts = [...apps.filter((s) => s.id === h.guess), ...apps.filter((s) => s.id !== h.guess)];
  const matched = h.matches[h.guess!] ?? 0;
  const callers = h.services.map((id) => nameOf(map, id));
  return (
    <div className="askbar" role="region" aria-label="Whose address is this?">
      <p>
        <span className="label">Whose address is this?</span> <b>{callers.length ? callers.join(" and ") : "The code"}</b> {callers.length > 1 ? "send" : "sends"} {plural(h.calls, "request")} to <code>{h.origin}</code>, an address on the internet that nothing in the
        repos ties to one of your services, so I can’t tell where they land. {oneApp ? <>Is it this app?</> : <>Is it your <b>{nameOf(map, h.guess!)}</b>?</>} {plural(matched, "request")} {matched === 1 ? "matches" : "match"} its routes.
      </p>
      <div className="row">
        {(oneApp ? opts.slice(0, 1) : opts).map((s) => (
          <button key={s.id} className={`ctl compact${s.id === h.guess ? " primary" : ""}`} onClick={() => answer(h.host, s.id)}>
            {oneApp ? `Yes, ${s.name}` : s.name}
          </button>
        ))}
        <button className="ctl compact" onClick={() => answer(h.host, null)} title="Its requests stay drawn as they are: guesses by path, and an outside service">
          Another company’s service
        </button>
        <button className="ctl compact ghost" onClick={() => answer(h.host, null)}>
          Not sure
        </button>
        <button className="link" title="Ask again next time; you can also answer in Details" onClick={onLater}>
          Not now
        </button>
        {rest > 0 && <span className="note">{plural(rest, "more question")} to answer in Details</span>}
      </div>
    </div>
  );
}

/** The prompt over the map: the question not answered yet that most requests rest on (the rest
 * wait in Details), or the redraw under way. Drawn again only when the map, the answers or the
 * redraw change, never on a click. */
export const AskBar = memo(function AskBar({ map }: { map: CodeMap }) {
  const ws = useWorkspace();
  const remap = useRemap();
  const [, setPutOff] = useState(0);
  if (!map.services.some((s) => s.kind === "app")) return null;
  if (remap) {
    return (
      <div className="askbar" role="status" aria-live="polite">
        {remap.error ? (
          <p>
            I couldn’t draw the map again with your answer: {remap.error}. Your answer is saved: add the folders again on the Folders page and map them, and it will be used.{" "}
            <button className="link" onClick={dismissRemap}>
              OK
            </button>
          </p>
        ) : (
          <p>
            Drawing the arrows again with your answer about <code>{remap.setting}</code>… {Math.round(remap.progress * 100)}%
          </p>
        )}
      </div>
    );
  }
  const open = (map.unresolvedBases ?? []).filter((b) => b.calls > 0 && !answerFor(map, ws?.assertions, b.setting) && !later.has(`${ws?.id}|${b.setting}`));
  const hosts = (map.publicHosts ?? []).filter((h) => askable(map, h) && !answerFor(map, ws?.assertions, h.host) && !later.has(`${ws?.id}|${h.host}`));
  // One question at a time: the one most requests rest on.
  const h = hosts[0];
  if (h && (!open[0] || h.calls > open[0].calls)) {
    const putOff = () => {
      later.add(`${ws?.id}|${h.host}`);
      setPutOff((n) => n + 1);
    };
    return <HostQuestion map={map} h={h} rest={open.length + hosts.length - 1} onLater={putOff} />;
  }
  const b = open[0];
  if (!b) return null;
  const oneApp = map.system.kind !== "services";
  const opts = choices(map, b);
  const standIn = map.services.some((s) => s.kind === "placeholder" && s.setting === b.setting);
  return (
    <div className="askbar" role="region" aria-label="Where does this point?">
      <p>
        {/* Said for someone new to this: what the code does, what's missing, then the question. */}
        <span className="label">Where does this point?</span> <b>{readers(map, b)}</b> {b.services.length > 1 ? "send" : "sends"} {plural(b.calls, "request")} to an address set in <code>{b.setting}</code>, but that
        address isn’t in the code.
        {standIn ? " Until you say, the ones this code can’t answer are drawn to a placeholder, as guesses." : ""}
        {b.guess && !oneApp ? ` Going by its name, it’s probably ${nameOf(map, b.guess)}.` : ""} {oneApp ? "Does it talk to this app?" : "Which of these does it talk to?"}
      </p>
      <div className="row">
        {oneApp ? (
          <button className="ctl compact" onClick={() => answer(b.setting, opts[0].id)}>
            Yes, {opts[0].name}
          </button>
        ) : (
          opts.map((s) => (
            <button key={s.id} className={`ctl compact${s.id === b.guess ? " primary" : ""}`} onClick={() => answer(b.setting, s.id)}>
              {s.name}
            </button>
          ))
        )}
        <button className="ctl compact" onClick={() => answer(b.setting, b.placeholder)} title="Its code isn't in this workspace: the requests are drawn to a stand-in for it">
          {ELSEWHERE}
        </button>
        <button className="ctl compact ghost" onClick={() => answer(b.setting, null)}>
          {oneApp ? "Somewhere else / not sure" : "An outside service / not sure"}
        </button>
        <button
          className="link"
          title="Ask again next time; you can also answer in Details"
          onClick={() => {
            later.add(`${ws?.id}|${b.setting}`);
            setPutOff((n) => n + 1);
          }}
        >
          Not now
        </button>
        {open.length + hosts.length > 1 && <span className="note">{plural(open.length + hosts.length - 1, "more question")} to answer in Details</span>}
      </div>
    </div>
  );
});

/** One setting's answer, to change or clear: used in Details. */
export function SettingAnswer({ map, setting }: { map: CodeMap; setting: string }) {
  const ws = useWorkspace();
  const remap = useRemap();
  const a = answerFor(map, ws?.assertions, setting);
  const busy = remap?.setting === setting && !remap.error;
  const apps = map.services.filter((s) => s.kind === "app");
  const elsewhere = map.unresolvedBases?.find((b) => b.setting === setting)?.placeholder;
  const known = a?.service && (apps.some((s) => s.id === a.service) || a.service === elsewhere);
  return (
    <div className="answerrow">
      <code className="mono">{setting}</code>
      <span className="how">points at</span>
      <select
        className="field"
        aria-label={`Where ${setting} points`}
        value={a ? (a.service ?? "") : "?"}
        disabled={busy || !ws}
        onChange={(e) => answer(setting, e.target.value === "?" ? undefined : e.target.value || null)}
      >
        {!a && <option value="?">not answered</option>}
        {apps.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
        {elsewhere && <option value={elsewhere}>a separate backend I don’t have here</option>}
        {a?.service && !known && <option value={a.service}>{a.service} (not on the map now)</option>}
        <option value="">an outside service / not sure</option>
      </select>
      {a && (
        <button className="link" disabled={busy || !ws} onClick={() => answer(setting, undefined)} title="Forget this answer; the arrows go back to what the code alone shows">
          clear
        </button>
      )}
      {busy && <span className="note">drawing again… {Math.round(remap!.progress * 100)}%</span>}
    </div>
  );
}

/** One address's answer, to change or clear: used in Details. "As the deploy config says" when the repos say whose it is. */
export function HostAnswer({ map, host }: { map: CodeMap; host: string }) {
  const ws = useWorkspace();
  const remap = useRemap();
  const a = answerFor(map, ws?.assertions, host);
  const h = map.publicHosts?.find((x) => x.host === host);
  const busy = remap?.setting === host && !remap.error;
  const apps = map.services.filter((s) => s.kind === "app");
  const known = a?.service && apps.some((s) => s.id === a.service);
  return (
    <div className="answerrow">
      <code className="mono">{h?.origin ?? host}</code>
      <span className="how">is</span>
      <select
        className="field"
        aria-label={`Whose address ${host} is`}
        value={a ? (a.service ?? "") : "?"}
        disabled={busy || !ws}
        onChange={(e) => answer(host, e.target.value === "?" ? undefined : e.target.value || null)}
      >
        {!a && <option value="?">{h?.config ? `${nameOf(map, h.config.service)}, as the deploy config says` : "not answered"}</option>}
        {apps.map((s) => (
          <option key={s.id} value={s.id}>
            {s.id === h?.guess && !h.config ? `${s.name} (its routes match)` : s.name}
          </option>
        ))}
        {a?.service && !known && <option value={a.service}>{a.service} (not on the map now)</option>}
        <option value="">another company’s service / not sure</option>
      </select>
      {a && (
        <button className="link" disabled={busy || !ws} onClick={() => answer(host, undefined)} title="Forget this answer; the arrows go back to what the code and config alone show">
          clear
        </button>
      )}
      {busy && <span className="note">drawing again… {Math.round(remap!.progress * 100)}%</span>}
    </div>
  );
}

/** Every setting with no value, every public address worth a word, and every answer, for Details when nothing is selected. */
export function SettingsList({ map, onOpen }: { map: CodeMap; onOpen: Open }) {
  const ws = useWorkspace();
  const bases = map.unresolvedBases ?? [];
  const hosts = (map.publicHosts ?? []).filter((h) => h.guess || h.config || answerFor(map, ws?.assertions, h.host));
  const unused = (ws?.assertions ?? []).filter((a) => (a.host ? !(map.publicHosts ?? []).some((h) => h.host === a.host) : !bases.some((b) => b.setting === a.setting)));
  if (!bases.length && !hosts.length && !unused.length) return null;
  return (
    <>
      {hosts.length > 0 && (
        <>
          <div className="label">Whose addresses</div>
          <p className="note">Addresses on the internet the code sends requests to, that may be one of your services. An answer settles their arrows, marked “you told WalkMyCode”; a service’s own deploy config can say it too.</p>
          <div className="edges">
            {hosts.map((h) => (
              <div key={h.host} className="pointrow">
                <HostAnswer map={map} host={h.host} />
                <div className="kind">
                  {h.services.map((id) => nameOf(map, id)).join(" and ") || "The code"} · {plural(h.calls, "request")} · {plural(h.links, "arrow")}
                  {h.guess && ` · ${plural(h.matches[h.guess] ?? 0, "request")} match ${nameOf(map, h.guess)}’s routes`}
                  {h.setAt[0] && (
                    <>
                      {" · set at "}
                      <button className="link mono" style={{ fontSize: "var(--text)" }} onClick={() => onOpen(h.setAt[0].file, h.setAt[0].line)}>
                        {h.setAt[0].file}:{h.setAt[0].line}
                      </button>
                    </>
                  )}
                  {h.config && (
                    <>
                      {" · "}
                      <button className="link mono" style={{ fontSize: "var(--text)" }} onClick={() => onOpen(h.config!.evidence.file, h.config!.evidence.line)}>
                        {h.config.evidence.file}:{h.config.evidence.line}
                      </button>
                      {` says it is ${nameOf(map, h.config.service)}`}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {(bases.length > 0 || unused.length > 0) && <SettingsRows map={map} bases={bases} unused={unused} onOpen={onOpen} />}
    </>
  );
}

/** The settings part of Details: each setting with no value, and answers no longer used. */
function SettingsRows({ map, bases, unused, onOpen }: { map: CodeMap; bases: UnresolvedBase[]; unused: { setting: string; host?: string }[]; onOpen: Open }) {
  return (
    <>
      <div className="label">Where settings point</div>
      <p className="note">
        Settings the code builds request addresses on, with no value anywhere in the repo. Arrows your answers settle are solid and marked “you told WalkMyCode”: the request is in the code, where it goes is your answer.
      </p>
      <div className="edges">
        {bases.map((b) => (
          <div key={b.setting} className="pointrow">
            <SettingAnswer map={map} setting={b.setting} />
            <div className="kind">
              {readers(map, b)} · {plural(b.calls, "request")} · {plural(b.links, "arrow")}
              {b.reads[0] && (
                <>
                  {" · read at "}
                  <button className="link mono" style={{ fontSize: "var(--text)" }} onClick={() => onOpen(b.reads[0].file, b.reads[0].line)}>
                    {b.reads[0].file}:{b.reads[0].line}
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
        {unused.map((a) => (
          <div key={a.setting} className="pointrow">
            {a.host ? <HostAnswer map={map} host={a.host} /> : <SettingAnswer map={map} setting={a.setting} />}
            <div className="kind">{a.host ? "Not used now: no request goes to this address." : "Not used now: the repo gives this setting a value, or no request is built on it."}</div>
          </div>
        ))}
      </div>
    </>
  );
}
