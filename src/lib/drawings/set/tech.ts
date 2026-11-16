// Computing, flow-and-waiting, and tools-and-ideas drawings. Same hand as base.ts.
import type { DrawingSet } from "../types";

const ring = (cx: number, cy: number, r: number, h: number) =>
  `M${cx} ${cy - r}a${r} ${r} 0 1 1 0 ${2 * r}a${r} ${r} 0 1 1 0-${2 * r}zM${cx} ${cy - h}a${h} ${h} 0 1 0 0 ${2 * h}a${h} ${h} 0 1 0 0-${2 * h}z`;
const star = "l2.6 6.4 6.9.5-5.3 4.5 1.7 6.7-5.9-3.7-5.9 3.7 1.7-6.7-5.3-4.5 6.9-.5z".replace(/00\b/g, "");

export const TECH: DrawingSet = {
  phone: { also: ["a mobile", "a device", "an app", "a call", "the client", "a handset"], tint: "#4b4f58", svg:
    '<ellipse class="d-sh" cx="32" cy="59.5" rx="15" ry="2"/><rect class="d-t" x="16" y="5" width="32" height="53" rx="5.5"/><rect class="d-sky" x="19.5" y="10" width="25" height="39" rx="1.5"/>' +
    '<rect class="d-w" x="23" y="14" width="13" height="3" rx="1.5"/><rect class="d-w" x="23" y="20" width="18" height="3" rx="1.5" opacity=".7"/>' +
    '<rect class="d-pk" x="23" y="28" width="8" height="8" rx="2"/><rect class="d-y" x="33" y="28" width="8" height="8" rx="2"/><rect class="d-gr" x="23" y="38" width="8" height="8" rx="2"/><rect class="d-pu" x="33" y="38" width="8" height="8" rx="2"/>' +
    '<circle class="d-t3" cx="32" cy="53.5" r="2.2"/>' },
  database: { also: ["a data store", "a store of records", "a filing room", "a table", "storage", "a warehouse"], tint: "#5f86b3", svg:
    [42, 28, 14].map((y) => `<path class="d-t" d="M10 ${y}v10a22 7 0 0 0 44 0v-10z"/><path class="d-t2" d="M54 ${y}v10a22 7 0 0 1-10 5.9v-10a22 7 0 0 0 10-5.9z"/><ellipse class="d-t3" cx="32" cy="${y}" rx="22" ry="7"/><circle class="d-gr" cx="17" cy="${y + 10.5}" r="1.8"/>`).join("") },
  folder: { also: ["a directory", "a file", "a project", "a collection", "a module"], tint: "#f0b84b", svg:
    '<ellipse class="d-sh" cx="32" cy="57" rx="25" ry="2.2"/><path class="d-t2" d="M6 14q0-3 3-3h14l5 6h27q3 0 3 3v30q0 3-3 3h-46q-3 0-3-3z"/><rect class="d-w" x="12" y="19" width="40" height="20" rx="2"/><rect class="d-w2" x="16" y="22" width="18" height="2.5" rx="1.2"/>' +
    '<path class="d-t" d="M6 28q0-3 3-3h46q3 0 3 3v23q0 3-3 3h-46q-3 0-3-3z"/><rect class="d-t3" x="6" y="25" width="52" height="4.5" rx="2.2"/><rect class="d-t3" x="12" y="44" width="16" height="4" rx="2"/>' },
  gear: { also: ["settings", "a cog", "a machine", "a process", "the engine", "configuration"], tint: "#8e929c", svg:
    '<g class="d-t">' + [0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<rect x="26.5" y="4" width="11" height="12" rx="2.5" transform="rotate(${a} 32 32)"/>`).join("") +
    `<path d="${ring(32, 32, 20, 7)}"/></g><path class="d-t2" d="${ring(32, 32, 12.5, 7)}"/><path class="d-t3" d="M17.5 26a15.5 15.5 0 0 1 8.5-8.5l1 2.5a13 13 0 0 0-7 7z"/>` },
  robot: { also: ["an ai", "a program", "a worker", "a bot", "an agent", "the computer"], tint: "#63c2a2", svg:
    '<rect class="d-w2" x="30.5" y="7" width="3" height="7"/><circle class="d-pk" cx="32" cy="6.5" r="3.5"/><rect class="d-w2" x="27" y="42" width="10" height="7"/><path class="d-t2" d="M9 59q0-12 12-12h22q12 0 12 12z"/><circle class="d-y" cx="32" cy="54" r="2.6"/>' +
    '<rect class="d-t2" x="6" y="22" width="7" height="11" rx="2.5"/><rect class="d-t2" x="51" y="22" width="7" height="11" rx="2.5"/><rect class="d-t" x="11" y="12" width="42" height="31" rx="9"/><rect class="d-t3" x="16" y="17" width="32" height="21" rx="7"/>' +
    '<circle class="d-ink" cx="25" cy="26" r="3.2"/><circle class="d-ink" cx="39" cy="26" r="3.2"/><circle class="d-w" cx="26" cy="25" r="1"/><circle class="d-w" cx="40" cy="25" r="1"/><path class="d-line" d="M27 32.5q5 3.5 10 0"/>' },
  shield: { also: ["security", "protection", "a firewall", "a defence", "safe", "armour"], tint: "#5f86b3", svg:
    '<path class="d-t" d="M32 5l23 8v16q0 18-23 30-23-12-23-30v-16z"/><path class="d-t2" d="M32 5l23 8v16q0 18-23 30z"/><path class="d-t3" d="M32 10.5l-18 6.2v5l18-6.2z"/><path class="d-line white" d="M22.5 31.5l6.5 6.5 12.5-13"/>' },
  bug: { also: ["an error", "a mistake", "a beetle", "a ladybird", "a defect", "a crash"], tint: "#e07f73", svg:
    '<path class="d-line grey" d="M15 27l-8-5M13 38h-9M15 48l-8 5M49 27l8-5M51 38h9M49 48l8 5M27 10q-2-5-7-5M37 10q2-5 7-5"/><circle class="d-dk" cx="32" cy="17" r="10"/>' +
    '<ellipse class="d-t" cx="32" cy="38" rx="20" ry="20.5"/><path class="d-t2" d="M32 17.5a20 20.5 0 0 1 0 41z"/><path class="d-line thin" d="M32 18v40"/>' +
    '<circle class="d-dk2" cx="22.5" cy="31" r="3.8"/><circle class="d-dk2" cx="41.5" cy="31" r="3.8"/><circle class="d-dk2" cx="21" cy="45" r="3.2"/><circle class="d-dk2" cx="43" cy="45" r="3.2"/>' +
    '<circle class="d-w" cx="27.5" cy="13.5" r="3"/><circle class="d-w" cx="36.5" cy="13.5" r="3"/><circle class="d-ink" cx="28" cy="14" r="1.4"/><circle class="d-ink" cx="37" cy="14" r="1.4"/>' },
  plug: { also: ["power", "a connection", "an adapter", "an extension", "plugged in", "an add-on"], tint: "#f0a94b", svg:
    '<rect class="d-w2" x="21" y="5" width="6" height="16" rx="2"/><rect class="d-w2" x="37" y="5" width="6" height="16" rx="2"/><path class="d-line thick tint" d="M32 50v4q0 4 5 4h9"/><rect class="d-t2" x="26.5" y="42" width="11" height="9" rx="2.5"/>' +
    '<path class="d-t" d="M13 21q0-3 3-3h32q3 0 3 3v8q0 16-16 16h-6q-16 0-16-16z"/><rect class="d-t3" x="13" y="18" width="38" height="5" rx="2.5"/>' +
    '<circle class="d-ink" cx="26" cy="30" r="1.8"/><circle class="d-ink" cx="38" cy="30" r="1.8"/><path class="d-line" d="M28 35.5q4 3 8 0"/>' },
  cable: { also: ["a wire", "a lead", "a link", "a cord", "a connection between two things"], tint: "#5f86b3", svg:
    '<path class="d-t" d="M9 42v-10a13 13 0 0 1 26 0a7 7 0 0 0 14 0v-10h6v10a13 13 0 0 1-26 0a7 7 0 0 0-14 0v10z"/>' +
    '<rect class="d-w" x="8.5" y="50" width="7" height="6" rx="1"/><rect class="d-w2" x="5.5" y="40" width="13" height="11" rx="2.5"/><rect class="d-w" x="48.5" y="8" width="7" height="6" rx="1"/><rect class="d-w2" x="45.5" y="13" width="13" height="11" rx="2.5"/>' },
  antenna: { also: ["wifi", "a radio mast", "a signal", "a broadcast", "a transmitter", "wireless"], tint: "#8e929c", svg:
    '<rect class="d-t2" x="19" y="54" width="26" height="4.5" rx="2.2"/><path class="d-t" d="M30 25h4l9 31h-5l-6-21-6 21h-5z"/><path class="d-t2" d="M26.5 42h11l1 3.5h-13z"/>' +
    '<path class="d-line yel thick" d="M24 14.5a10.5 10.5 0 0 0 0 15M40 14.5a10.5 10.5 0 0 1 0 15M17 8.5a19 19 0 0 0 0 27M47 8.5a19 19 0 0 1 0 27"/><circle class="d-pk" cx="32" cy="22" r="4.5"/>' },
  chip: { also: ["a processor", "the cpu", "a microchip", "the brain of the computer", "a circuit"], tint: "#4e8f7a", svg:
    '<path class="d-line grey thick" d="M20 6v8M28 6v8M36 6v8M44 6v8M20 50v8M28 50v8M36 50v8M44 50v8M6 20h8M6 28h8M6 36h8M6 44h8M50 20h8M50 28h8M50 36h8M50 44h8"/>' +
    '<rect class="d-t" x="11" y="11" width="42" height="42" rx="5"/><rect class="d-t3" x="11" y="11" width="42" height="5" rx="2.5"/><rect class="d-t2" x="20" y="21" width="24" height="24" rx="3"/><rect class="d-t3" x="26" y="27" width="12" height="12" rx="2"/><circle class="d-y" cx="16.5" cy="21" r="1.8"/>' },
  screen: { also: ["a monitor", "a display", "a window", "a terminal", "the ui", "the desktop"], tint: "#4b4f58", svg:
    '<rect class="d-w2" x="28" y="44" width="8" height="10"/><rect class="d-w3" x="18" y="52" width="28" height="5.5" rx="2.7"/><rect class="d-t" x="4" y="7" width="56" height="39" rx="3.5"/><rect class="d-sky" x="7.5" y="10.5" width="49" height="32" rx="1.5"/>' +
    '<rect class="d-w" x="14" y="15" width="32" height="23" rx="2"/><path class="d-bl2" d="M14 21v-4q0-2 2-2h28q2 0 2 2v4z"/><circle class="d-pk" cx="17.5" cy="18" r="1.3"/><circle class="d-y" cx="21.5" cy="18" r="1.3"/>' +
    '<rect class="d-w2" x="18" y="25" width="16" height="3" rx="1.5"/><rect class="d-w2" x="18" y="31" width="23" height="3" rx="1.5"/>' },
  cursor: { also: ["a pointer", "a click", "the mouse", "a reference", "pointing at something", "a selection"], tint: "#f4f5f7", svg:
    '<path class="d-sh" d="M21 14l32 25-14.5 2.5 8.5 16-7 3.7-8.5-16.5-10.5 9z"/><path class="d-t" d="M18 10l32 25-14.5 2.5 8.5 16-7 3.7-8.5-16.5-10.5 9z"/><path class="d-t2" d="M18 10l32 25-14.5 2.5 8.5 16-3.5 1.85z"/>' +
    '<path class="d-line yel" d="M9 5l4 4M5 16h5M18 2v3"/>' },
  token: { also: ["a ticket", "a pass", "a badge", "an api credential", "a coin", "a session"], tint: "#f3c14b", svg:
    `<circle class="d-t2" cx="32" cy="34.5" r="24"/><circle class="d-t" cx="32" cy="31" r="24"/><circle class="d-t3" cx="32" cy="31" r="18.5"/><circle class="d-t" cx="32" cy="31" r="15.5"/><path class="d-w" d="M32 20.5${star}"/>` },

  queue: { also: ["a line of people", "waiting in line", "first in, first out", "a waiting list", "a buffer"], tint: "#7fbfe6", svg:
    '<rect class="d-w2" x="3" y="52" width="58" height="4.5" rx="2.2"/>' +
    [[12, "d-t2"], [32, "d-t"], [52, "d-t3"]].map(([x, c]) => `<path class="${c}" d="M${+x - 8} 53v-12a8 8 0 0 1 16 0v12z"/><circle class="d-cream" cx="${x}" cy="25.5" r="6"/><circle class="d-ink" cx="${+x - 0.5}" cy="25" r="1"/><circle class="d-ink" cx="${+x + 3.5}" cy="25" r="1"/>`).join("") +
    '<path class="d-line yel" d="M20 10h23m-5-5l5 5-5 5"/>' },
  stack: { also: ["a pile of plates", "a pile", "last in, first out", "the call stack", "layers"], tint: "#9fd0ea", svg:
    '<ellipse class="d-sh" cx="32" cy="57.5" rx="22" ry="2.5"/>' + [48, 41, 34, 27, 20].map((y) => `<ellipse class="d-t2" cx="32" cy="${y + 2.5}" rx="25" ry="6"/><ellipse class="d-t" cx="32" cy="${y}" rx="25" ry="6"/>`).join("") + '<ellipse class="d-t3" cx="32" cy="20" rx="16" ry="3.4"/>' },
  pipe: { also: ["a pipeline", "a stream", "a channel", "plumbing", "a tap", "a flow of data"], tint: "#6fa3b8", svg:
    '<path class="d-t" d="M4 12h40q14 0 14 14v12h-16v-10h-38z"/><rect class="d-t3" x="4" y="15" width="38" height="3.5" rx="1.7"/><path class="d-t2" d="M52 26h6v12h-6z"/>' +
    '<rect class="d-t2" x="2" y="9" width="6" height="22" rx="2"/><rect class="d-t2" x="22" y="9" width="6" height="22" rx="2"/><rect class="d-t2" x="39" y="36" width="22" height="6" rx="2"/>' +
    '<path class="d-bl" d="M50 44c4 5 5.5 7 5.5 9.5a5.5 5.5 0 0 1-11 0c0-2.5 1.5-4.5 5.5-9.5z"/><circle class="d-sky" cx="48" cy="54" r="1.6"/>' },
  funnel: { also: ["a filter", "narrowing down", "a sieve", "a bottleneck", "pouring in"], tint: "#f0a94b", svg:
    '<circle class="d-pk" cx="20" cy="8" r="3.5"/><circle class="d-bl" cx="32" cy="6" r="3.5"/><circle class="d-gr" cx="44" cy="8" r="3.5"/><path class="d-t" d="M8 18h48l-18 19v12l-12 5v-17z"/><path class="d-t2" d="M32 18h24l-18 19v12l-6 2.5z"/><rect class="d-t3" x="5" y="14" width="54" height="6" rx="3"/><circle class="d-bl" cx="32" cy="58" r="2.5"/>' },
  trafficlight: { also: ["stop or go", "a signal light", "a lock", "a semaphore", "wait your turn", "a status"], tint: "#555a66", svg:
    '<rect class="d-t2" x="29" y="48" width="6" height="10"/><rect class="d-t2" x="21" y="55.5" width="22" height="4" rx="2"/><rect class="d-t" x="18" y="4" width="28" height="47" rx="7"/><rect class="d-t3" x="18" y="4" width="28" height="5" rx="2.5" opacity=".5"/>' +
    '<circle class="d-dk2" cx="32" cy="14" r="6"/><circle class="d-dk2" cx="32" cy="27.5" r="6"/><circle class="d-dk2" cx="32" cy="41" r="6"/>' +
    '<g class="ok"><circle class="d-gr" cx="32" cy="41" r="8.5" opacity=".3"/><circle class="d-gr" cx="32" cy="41" r="6"/></g><g class="no"><circle class="d-rd" cx="32" cy="14" r="8.5" opacity=".3"/><circle class="d-rd" cx="32" cy="14" r="6"/></g>' },
  gate: { also: ["a barrier", "a door", "an entrance", "a way in", "a checkpoint", "a guard clause"], tint: "#c9935b", svg:
    '<ellipse class="d-sh" cx="32" cy="58.5" rx="28" ry="2.2"/>' +
    '<g class="no"><path class="d-t" d="M17 21q0-2.5 2.5-2.5t2.5 2.5v33h-5zM25.5 21q0-2.5 2.5-2.5t2.5 2.5v33h-5zM33.5 21q0-2.5 2.5-2.5t2.5 2.5v33h-5zM42 21q0-2.5 2.5-2.5t2.5 2.5v33h-5z"/><path class="d-t3" d="M13 26h38v5h-38zM13 43h38v5h-38z"/><rect class="d-rd" x="42" y="33.5" width="10" height="7" rx="2"/></g>' +
    '<g class="ok"><path class="d-t" d="M13 16l13 7v35l-13-4z"/><path class="d-t3" d="M13 24l13 5.5v5l-13-5.5zM13 41l13 4.5v5l-13-4.5z"/><path class="d-gr" d="M30 35.5h9v-5.5l9.5 8.5-9.5 8.5v-5.5h-9z"/></g>' +
    '<rect class="d-t2" x="5" y="10" width="9" height="48" rx="2.5"/><rect class="d-t2" x="50" y="10" width="9" height="48" rx="2.5"/><rect class="d-t3" x="5" y="10" width="9" height="4" rx="2"/><rect class="d-t3" x="50" y="10" width="9" height="4" rx="2"/>' },
  signpost: { also: ["a router", "a choice", "directions", "a fork in the road", "a branch", "an if"], tint: "#63c2a2", svg:
    '<ellipse class="d-sh" cx="32" cy="58" rx="13" ry="2.2"/><rect class="d-wood" x="29" y="6" width="6" height="52" rx="2"/><path class="d-t" d="M15 10h29l9 8-9 8h-29q-2.5 0-2.5-2.5v-11q0-2.5 2.5-2.5z"/><rect class="d-w" x="18" y="16.5" width="18" height="3" rx="1.5"/>' +
    '<path class="d-or" d="M49 30h-29l-9 8 9 8h29q2.5 0 2.5-2.5v-11q0-2.5-2.5-2.5z"/><rect class="d-w" x="28" y="36.5" width="18" height="3" rx="1.5"/>' },
  mailbox: { also: ["a postbox", "an inbox", "an address", "an endpoint", "where messages arrive"], tint: "#e07f73", svg:
    '<ellipse class="d-sh" cx="32" cy="59" rx="15" ry="2"/><rect class="d-wood" x="27" y="44" width="10" height="15" rx="1"/><path class="d-t" d="M7 47v-15q0-14 14-14h22q14 0 14 14v15z"/><path class="d-t3" d="M7 47v-15q0-14 13-14t13 14v15z"/>' +
    '<rect class="d-w" x="12" y="36" width="16" height="7" rx="1"/><path class="d-line thin2" d="M12.5 36.5l7.5 4 7.5-4"/><circle class="d-t2" cx="20" cy="27" r="2.2"/><rect class="d-t2" x="7" y="45" width="50" height="3.5" rx="1.5"/>' +
    '<rect class="d-y2" x="42.5" y="8" width="3.5" height="25" rx="1.7"/><path class="d-y" d="M46 8h11v9h-11z"/>' },
  bell: { also: ["a notification", "an alert", "an event", "an alarm", "a reminder", "a ring"], tint: "#f3c14b", svg:
    '<circle class="d-t2" cx="32" cy="9" r="4"/><circle class="d-t2" cx="32" cy="52" r="6"/><path class="d-t" d="M32 9c-11 0-16.5 8-16.5 19 0 9-3 14-7.5 17v4h48v-4c-4.5-3-7.5-8-7.5-17 0-11-5.5-19-16.5-19z"/><rect class="d-t2" x="6" y="45" width="52" height="5" rx="2.5"/>' +
    '<ellipse class="d-t3" cx="24" cy="24" rx="2.5" ry="7.5" transform="rotate(14 24 24)"/><path class="d-line yel" d="M8 14q-4 7-2 15M56 14q4 7 2 15"/>' },
  hourglass: { also: ["a timer", "waiting", "a timeout", "a delay", "loading", "time running out"], tint: "#c9935b", svg:
    '<path class="d-sky" d="M17 11h30v9q0 7-10 12 10 5 10 12v9h-30v-9q0-7 10-12-10-5-10-12z"/><path class="d-y" d="M20 21h24q-1 4.5-9 9h-6q-8-4.5-9-9zM31.2 30h1.6v16h-1.6zM20 53q2-8 12-9 10 1 12 9z"/><path class="d-w" d="M20.5 15h4v6h-4z" opacity=".7"/>' +
    '<rect class="d-t" x="11" y="6" width="42" height="7" rx="3.5"/><rect class="d-t" x="11" y="51" width="42" height="7" rx="3.5"/><rect class="d-t2" x="11" y="55" width="42" height="3" rx="1.5"/>' },
  calendar: { also: ["a date", "a schedule", "a deadline", "a diary", "a timetable", "a scheduled job"], tint: "#e07f73", svg:
    '<rect class="d-w" x="7" y="11" width="50" height="47" rx="4.5"/><path class="d-t" d="M7 15.5q0-4.5 4.5-4.5h41q4.5 0 4.5 4.5v10.5h-50z"/><rect class="d-w2" x="17" y="5" width="5.5" height="13" rx="2.7"/><rect class="d-w2" x="41.5" y="5" width="5.5" height="13" rx="2.7"/>' +
    '<path class="d-w2" d="M13 31h8v6h-8zM35 31h8v6h-8zM46 31h6v6h-6zM13 40h8v6h-8zM24 40h8v6h-8zM46 40h6v6h-6zM13 49h8v5h-8zM24 49h8v5h-8zM35 49h8v5h-8z"/><rect class="d-t" x="24" y="31" width="8" height="6" rx="1"/><rect class="d-gr" x="35" y="40" width="8" height="6" rx="1"/>' },
  switch: { also: ["a light switch", "on or off", "a boolean", "a toggle", "a flag", "true or false"], tint: "#e9e4d8", svg:
    '<rect class="d-t2" x="13" y="6" width="38" height="53" rx="6"/><rect class="d-t" x="13" y="5" width="38" height="51" rx="6"/><circle class="d-w2" cx="32" cy="11" r="1.8"/><circle class="d-w2" cx="32" cy="50" r="1.8"/>' +
    '<rect class="d-dk" x="22" y="16" width="20" height="29" rx="3.5"/><rect class="d-w" x="24" y="18" width="16" height="14" rx="2"/><rect class="d-w2" x="24" y="33" width="16" height="10" rx="2"/><circle class="d-gr" cx="32" cy="24" r="2.8"/>' },

  magnifier: { also: ["a search", "looking closely", "a lens", "inspecting", "a debugger", "finding something"], tint: "#5f86b3", svg:
    `<path class="d-t2" d="M37 43l6-6 15 15q3 3 0 6t-6 0z"/><path class="d-t" d="${ring(26, 26, 20, 14.5)}"/><circle class="d-sky" cx="26" cy="26" r="14.5" opacity=".85"/><path class="d-line white" d="M17 26a9 9 0 0 1 9-9"/>` },
  toolbox: { also: ["a toolkit", "a library of tools", "a set of tools", "a workshop", "a kit"], tint: "#d9534f", svg:
    '<ellipse class="d-sh" cx="32" cy="58" rx="25" ry="2.2"/><path class="d-line grey thick" d="M22 23v-7q0-5 5-5h10q5 0 5 5v7"/><rect class="d-t" x="5" y="21" width="54" height="35" rx="4"/><rect class="d-t3" x="5" y="21" width="54" height="5" rx="2.5"/>' +
    '<rect class="d-t2" x="5" y="33" width="54" height="4.5"/><rect class="d-y" x="13" y="30" width="8" height="10" rx="1.5"/><rect class="d-y" x="43" y="30" width="8" height="10" rx="1.5"/><rect class="d-t2" x="5" y="51" width="54" height="5" rx="2.5"/>' },
  wrench: { also: ["a spanner", "a fix", "a repair", "a tool", "maintenance", "a patch"], tint: "#8e929c", svg:
    '<g transform="rotate(45 32 32)"><rect class="d-t" x="26.5" y="14" width="11" height="52" rx="5.5"/><rect class="d-t3" x="29" y="22" width="2.5" height="30" rx="1.2"/><path class="d-t" d="M26-5.3a13 13 0 1 0 12 0v10a6 6 0 0 1-12 0z"/><path class="d-t2" d="M38-5.3a13 13 0 0 1 0 23z"/><circle class="d-t2" cx="32" cy="59" r="2.5"/></g>' },
  puzzle: { also: ["a jigsaw piece", "a piece that fits", "a part", "a plugin", "an interface", "a missing piece"], tint: "#b79cf0", svg:
    '<path class="d-t" d="M9 22h13a7 7 0 1 1 10 0h12v12a7 7 0 1 1 0 10v13h-12a6 6 0 1 0-10 0h-13v-13a6 6 0 1 0 0-10z"/><path class="d-t2" d="M9 57v-4h13v4zM32 57v-4h12v4z"/>' +
    '<rect class="d-t3" x="13" y="26" width="15" height="3" rx="1.5"/><ellipse class="d-t3" cx="24.5" cy="14.5" rx="2.8" ry="2"/>' },
  brick: { also: ["a building block", "a component", "a block", "a toy brick", "a unit", "a piece to build with"], tint: "#d9534f", svg:
    '<ellipse class="d-sh" cx="32" cy="58" rx="26" ry="2.2"/>' + [10, 26, 42].map((x) => `<rect class="d-t" x="${x}" y="11" width="12" height="14" rx="2.5"/><rect class="d-t3" x="${x}" y="11" width="12" height="4" rx="2"/>`).join("") +
    '<rect class="d-t" x="5" y="21" width="54" height="35" rx="3.5"/><rect class="d-t3" x="5" y="21" width="54" height="5" rx="2.5"/><rect class="d-t2" x="5" y="48" width="54" height="8" rx="3"/>' },
  recipe: { also: ["a recipe card", "a cookbook", "an algorithm", "a function", "instructions", "a set of steps"], tint: "#f0a94b", svg:
    '<ellipse class="d-sh" cx="32" cy="58.5" rx="22" ry="2"/><rect class="d-cream" x="8" y="8" width="48" height="49" rx="4"/><path class="d-t" d="M8 12q0-4 4-4h40q4 0 4 4v13h-48z"/><rect class="d-w" x="13" y="15" width="17" height="3.5" rx="1.7"/>' +
    '<g class="d-w"><circle cx="40" cy="14.5" r="3.5"/><circle cx="45" cy="13" r="4"/><circle cx="50" cy="14.5" r="3.5"/><rect x="40.5" y="15" width="9" height="7" rx="1"/></g>' +
    '<circle class="d-t" cx="16" cy="33" r="2.5"/><circle class="d-t" cx="16" cy="41" r="2.5"/><circle class="d-t" cx="16" cy="49" r="2.5"/><path class="d-w2" d="M22 31.5h26v3h-26zM22 39.5h20v3h-20zM22 47.5h24v3h-24z"/>' },
  trophy: { also: ["a prize", "a win", "a cup", "success", "a goal reached", "first place"], tint: "#f3c14b", svg:
    '<path class="d-line thick tint" d="M18 12h-6q-4 0-4 4 0 9 12 11M46 12h6q4 0 4 4 0 9-12 11"/><rect class="d-t2" x="28.5" y="34" width="7" height="12"/><rect class="d-t2" x="21" y="43" width="22" height="5.5" rx="2"/><rect class="d-wood" x="16" y="48" width="32" height="10" rx="2"/><rect class="d-y" x="25" y="51.5" width="14" height="3" rx="1.5"/>' +
    '<path class="d-t" d="M17 7h30v15q0 15-15 15t-15-15z"/><path class="d-t2" d="M40 7h7v15q0 12-9 14.3 2-5 2-14.3z"/><rect class="d-t3" x="21" y="10" width="3.5" height="13" rx="1.7"/><path class="d-w" d="M32 13.5l1.6 3.8 4.1.3-3.2 2.7 1 4-3.5-2.2-3.5 2.2 1-4-3.2-2.7 4.1-.3z"/>' },
  bin: { also: ["a rubbish bin", "a trash can", "garbage collection", "deleted", "thrown away", "the recycle bin"], tint: "#8e929c", svg:
    '<ellipse class="d-sh" cx="32" cy="58.5" rx="19" ry="2"/><rect class="d-t2" x="25" y="5" width="14" height="9" rx="3"/><path class="d-t" d="M12 20h40l-3.6 34.5q-.4 3.5-3.9 3.5h-25q-3.5 0-3.9-3.5z"/><path class="d-t2" d="M21 26h4.5l1 26h-4.5zM29.8 26h4.4v26h-4.4zM38.5 26h4.5l-1 26h-4.5z"/>' +
    '<rect class="d-t3" x="8" y="12" width="48" height="8" rx="3.5"/>' },
};
