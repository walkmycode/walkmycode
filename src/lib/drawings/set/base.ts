// The first drawings (docs/design/learn-drawings.html): the ones the two worked examples need.
import type { DrawingSet } from "../types";
import { cap, eyes, person } from "./parts";

export const BASE: DrawingSet = {
  child: { person: true, also: ["a pupil", "a friend", "you", "a player"], tint: "#f3d77a", svg:
    person('<rect class="d-sk2" x="28" y="33" width="8" height="10" rx="3"/><path class="d-t2" d="M24.5 41.5l7.5 7 7.5-7-3.5-1.5h-8z"/>') +
    '<g class="h-b"><circle class="d-hr" cx="15.5" cy="27" r="6"/><circle class="d-hr" cx="48.5" cy="27" r="6"/></g>' +
    '<circle class="d-sk" cx="32" cy="25" r="14"/>' +
    `<g class="h-a">${cap}</g><path class="d-hr h-b" d="M18 27c-2-12 5-18 14-18s16 6 14 18c-2-7-6-9-10-9-3 3-11 3-18 9z"/>` +
    '<g class="h-c d-hr"><circle cx="21.5" cy="15.5" r="6"/><circle cx="32" cy="12" r="7"/><circle cx="42.5" cy="15.5" r="6"/><circle cx="18" cy="22" r="4"/><circle cx="46" cy="22" r="4"/></g>' +
    eyes(1.8) + '<circle class="d-blush" cx="22.5" cy="31" r="2.6"/><circle class="d-blush" cx="41.5" cy="31" r="2.6"/>' +
    '<path class="d-line smile" d="M27 31.5q5 5 10 0"/><path class="d-line frown" d="M27.5 35q4.5-4 9 0"/>' },
  teacher: { person: true, also: ["a referee", "a judge", "a guard", "a librarian"], tint: "#7b7fb5", hair: "#9a9ca6", svg:
    person('<path class="d-w" d="M25 40h14l-7 13z"/><rect class="d-sk2" x="28" y="33" width="8" height="9" rx="3"/><path class="d-t2" d="M25.5 39.5l-5.5 3.5 10 14zM38.5 39.5l5.5 3.5-10 14z"/><circle class="d-y" cx="32" cy="46" r="2.2"/>') +
    '<circle class="d-hr" cx="32" cy="7.5" r="5.5"/><circle class="d-sk" cx="32" cy="25" r="14"/>' + cap + eyes(1.4) +
    '<g class="d-glass"><circle cx="26.5" cy="26" r="5"/><circle cx="37.5" cy="26" r="5"/><path d="M31.5 26h1"/></g>' +
    '<path class="d-line ok smile" d="M28 33.5q4 2 8 0"/><path class="d-line frown" d="M28 35.5q4-3 8 0"/><ellipse class="d-ink no" cx="32" cy="34.5" rx="2.6" ry="3"/><path class="d-line no" d="M20.5 17.5l7.5 3M43.5 17.5l-7.5 3"/>' },
  teddy: { also: ["a toy", "a favourite thing", "a cuddly toy", "a soft toy"], tint: "#c58d57", svg:
    '<circle class="d-t" cx="19" cy="13" r="6.5"/><circle class="d-t" cx="45" cy="13" r="6.5"/><circle class="d-t3" cx="19" cy="13" r="3.2"/><circle class="d-t3" cx="45" cy="13" r="3.2"/>' +
    '<ellipse class="d-t2" cx="16.5" cy="43" rx="5.5" ry="8.5" transform="rotate(24 16.5 43)"/><ellipse class="d-t2" cx="47.5" cy="43" rx="5.5" ry="8.5" transform="rotate(-24 47.5 43)"/>' +
    '<circle class="d-t2" cx="22" cy="57" r="6"/><circle class="d-t2" cx="42" cy="57" r="6"/><circle class="d-t3" cx="22" cy="57.5" r="3"/><circle class="d-t3" cx="42" cy="57.5" r="3"/>' +
    '<ellipse class="d-t" cx="32" cy="46" rx="13.5" ry="13"/><ellipse class="d-t3" cx="32" cy="48" rx="8" ry="8.5"/>' +
    '<circle class="d-t" cx="32" cy="24" r="13.5"/><ellipse class="d-t3" cx="32" cy="29.5" rx="6.5" ry="5.2"/>' +
    '<circle class="d-ink" cx="26.5" cy="21.5" r="1.7"/><circle class="d-ink" cx="37.5" cy="21.5" r="1.7"/><ellipse class="d-ink" cx="32" cy="27.5" rx="2.3" ry="1.7"/><path class="d-line thin" d="M32 29v2m-3 .2q3 2.6 6 0"/>' },
  box: { also: ["a toy box", "a chest", "a lunch box", "a bin", "a cupboard"], tint: "#c9935b", svg:
    '<path class="d-t2" d="M11 30l4-17h34l4 17z"/><circle class="d-pk" cx="22" cy="26" r="8"/><path class="d-w" d="M14.5 24q7.5-4 15 0v3q-7.5-4-15 0z"/>' +
    '<rect class="d-bl" x="33" y="17" width="13" height="13" rx="1.5" transform="rotate(12 39.5 23.5)"/><path class="d-y" d="M30 13l1.8 3.8 4.2.5-3.1 2.9.8 4.1-3.7-2-3.7 2 .8-4.1-3.1-2.9 4.2-.5z"/>' +
    '<rect class="d-t" x="8" y="30" width="48" height="27" rx="2.5"/><rect class="d-t2" x="8" y="40" width="48" height="4.5"/><rect class="d-y" x="28.5" y="36" width="7" height="11" rx="1.5"/><circle class="d-ink" cx="32" cy="42.5" r="1.3"/>' },
  drawer: { also: ["a variable", "a named box", "a pigeonhole", "a locker"], tint: "#5f86b3", svg:
    '<rect class="d-t2" x="7" y="8" width="50" height="50" rx="4"/><rect class="d-t" x="11" y="24" width="42" height="30" rx="2.5"/><rect class="d-t3" x="11" y="24" width="42" height="5" rx="2.5"/>' +
    '<rect class="d-w" x="18" y="12" width="28" height="8.5" rx="1.5"/><rect class="d-w2" x="21.5" y="15" width="13" height="2.5" rx="1.2"/><rect class="d-y" x="25" y="37" width="14" height="5" rx="2.5"/>' },
  memory: { also: ["a value", "data on the heap", "a row of cells"], tint: "#63c2a2", svg:
    '<rect class="d-w2" x="3" y="43" width="58" height="7" rx="2.5"/><path class="d-line grey thick" d="M11 50v6M24 50v6M40 50v6M53 50v6"/>' +
    '<rect class="d-t" x="5" y="18" width="12.5" height="24" rx="2.5"/><rect class="d-t2" x="19" y="18" width="12.5" height="24" rx="2.5"/><rect class="d-t" x="33" y="18" width="12.5" height="24" rx="2.5"/><rect class="d-t2" x="47" y="18" width="12.5" height="24" rx="2.5"/>' +
    '<path class="d-t3" d="M7.5 21.5h7.5v3h-7.5zM21.5 21.5h7.5v3h-7.5zM35.5 21.5h7.5v3h-7.5zM49.5 21.5h7.5v3h-7.5z"/>' },
  checker: { also: ["the compiler", "a checklist", "an inspector", "the rules"], tint: "#9a7652", svg:
    '<rect class="d-t" x="11" y="8" width="42" height="51" rx="4.5"/><rect class="d-w" x="15.5" y="14" width="33" height="41" rx="2"/><rect class="d-w2" x="24" y="4.5" width="16" height="9" rx="2.5"/>' +
    '<rect class="d-w2" x="20" y="21" width="22" height="3" rx="1.5"/><rect class="d-w2" x="20" y="28" width="15" height="3" rx="1.5"/>' +
    '<g class="ok"><circle class="d-gr" cx="37" cy="43" r="9.5"/><path class="d-line white" d="M32.5 43l3.3 3.3 6-6.3"/></g><g class="no"><circle class="d-pk" cx="37" cy="43" r="9.5"/><path class="d-line white" d="M33.5 39.5l7 7M40.5 39.5l-7 7"/></g>' },
  van: { also: ["the postman", "a courier", "a delivery", "the network"], tint: "#f0a94b", svg:
    '<ellipse class="d-sh" cx="32" cy="55" rx="27" ry="2.5"/><rect class="d-t" x="3" y="18" width="36" height="30" rx="3.5"/><path class="d-t2" d="M39 26h11l10 10v12h-21z"/><path class="d-sky" d="M43 29.5h5.5l6.5 6.5h-12z"/>' +
    '<rect class="d-w" x="11" y="26" width="19" height="13" rx="1.5"/><path class="d-line thin2" d="M11.5 27l9.5 7 9.5-7"/><rect class="d-t2" x="3" y="43" width="57" height="5" rx="1.5"/>' +
    '<circle class="d-ink" cx="15" cy="49" r="6.5"/><circle class="d-ink" cx="47" cy="49" r="6.5"/><circle class="d-w2" cx="15" cy="49" r="2.6"/><circle class="d-w2" cx="47" cy="49" r="2.6"/>' },
  shop: { also: ["a shop", "a kitchen", "a library", "a server"], tint: "#e07f73", svg:
    '<rect class="d-cream" x="9" y="27" width="46" height="31" rx="1.5"/><rect class="d-y" x="20" y="4.5" width="24" height="8.5" rx="1.5"/><path class="d-t" d="M5 28l5.5-15h43l5.5 15z"/>' +
    '<path class="d-w" d="M16.8 13h7.2l-1.6 15h-9.2zM31.6 13h.800l3.6 15h-7.2zM40 13h7.2l3.6 15h-9.2z" opacity=".92"/><path class="d-t2" d="M5 28h54v3.5h-54z"/>' +
    '<rect class="d-sky" x="14" y="36.5" width="17" height="13" rx="1"/><path class="d-w" d="M14 36.5l6 0-6 6z" opacity=".5"/><rect class="d-wood" x="36.5" y="36.5" width="12" height="21.5" rx="1"/><circle class="d-y" cx="45.5" cy="47.5" r="1.4"/>' },
  letter: { also: ["an order", "a message", "a request", "a note"], tint: "#f4f5f7", svg:
    '<ellipse class="d-sh" cx="32" cy="55" rx="23" ry="2.2"/><rect class="d-w" x="6" y="15" width="52" height="37" rx="3.5"/><path class="d-w3" d="M6.5 49.5l19-16.5h13l19 16.5q-1 2.5-3.5 2.5h-44q-2.5 0-3.5-2.5z"/><path class="d-w2" d="M6.5 17.5q1-2.5 3.5-2.5h44q2.5 0 3.5 2.5l-25.5 20z"/><circle class="d-pk" cx="32" cy="35" r="4.5"/>' },
  parcel: { also: ["a parcel", "an answer", "a response", "a present"], tint: "#c9935b", svg:
    '<ellipse class="d-sh" cx="32" cy="57" rx="22" ry="2.5"/><path class="d-t3" d="M32 6l25 12-25 12-25-12z"/><path class="d-t" d="M7 18l25 12v27l-25-12z"/><path class="d-t2" d="M57 18l-25 12v27l25-12z"/>' +
    '<path class="d-y" d="M17.5 12.9l25 12 4.5-2.2-25-12z"/><path class="d-y2" d="M42.5 24.9l4.5-2.2v10l-4.5 2.2z"/><path class="d-w" d="M13 31l10 4.8v8l-10-4.8z"/>' },
  laptop: { also: ["the browser", "a computer", "a screen"], tint: "#4b4f58", svg:
    '<rect class="d-t" x="10" y="9" width="44" height="33" rx="3.5"/><rect class="d-sky" x="13.5" y="12.5" width="37" height="26" rx="1.5"/><rect class="d-w" x="13.5" y="12.5" width="37" height="6" rx="1.5"/>' +
    '<circle class="d-pk" cx="17" cy="15.5" r="1.3"/><circle class="d-y" cx="21" cy="15.5" r="1.3"/><circle class="d-gr" cx="25" cy="15.5" r="1.3"/><rect class="d-w" x="18" y="23" width="16" height="3" rx="1.5"/><rect class="d-w" x="18" y="29.5" width="26" height="3" rx="1.5" opacity=".7"/>' +
    '<path class="d-w2" d="M4 45h56l-3.5 8q-.8 2-3 2h-43q-2.2 0-3-2z"/><rect class="d-w3" x="25" y="45" width="14" height="3" rx="1.5"/>' },
  cloud: { also: ["the internet", "the weather", "somewhere far away"], tint: "#eef3fa", svg:
    '<path class="d-t2c" d="M17 50a12 12 0 0 1 .5-24 15.5 15.5 0 0 1 30 3.5 10.5 10.5 0 0 1-.5 20.5z"/><path class="d-t" d="M17 46a12 12 0 0 1 .5-22 15.5 15.5 0 0 1 30 3.5 10.5 10.5 0 0 1 .5 18.5z"/>' +
    '<path class="d-line net" d="M22 37l10-7 10 7M32 30v-0"/><circle class="d-bl" cx="22" cy="37" r="3"/><circle class="d-bl" cx="32" cy="30" r="3"/><circle class="d-bl" cx="42" cy="37" r="3"/>' },
  server: { also: ["the server", "a machine that answers", "a database"], tint: "#555a66", svg:
    [8, 25, 42].map((y) => `<rect class="d-t" x="10" y="${y}" width="44" height="14" rx="3"/><rect class="d-t2" x="32" y="${y + 5.5}" width="17" height="3" rx="1.5"/><circle class="d-gr" cx="17" cy="${y + 7}" r="2"/><circle class="${y === 25 ? "d-y" : "d-gr"}" cx="24" cy="${y + 7}" r="2"/>`).join("") + '<ellipse class="d-sh" cx="32" cy="59.5" rx="22" ry="2"/>' },
  page: { also: ["a web page", "a request", "a form", "a report"], tint: "#7fbfe6", svg:
    '<ellipse class="d-sh" cx="32" cy="58" rx="19" ry="2"/><path class="d-w" d="M13 6h27l11 11v36q0 3-3 3h-35q-3 0-3-3v-44q0-3 3-3z"/><path class="d-w2" d="M40 6l11 11h-8q-3 0-3-3z"/>' +
    '<rect class="d-t" x="17" y="14" width="18" height="6" rx="1.5"/><rect class="d-w2" x="17" y="26" width="29" height="3" rx="1.5"/><rect class="d-w2" x="17" y="33" width="29" height="3" rx="1.5"/><rect class="d-w2" x="17" y="40" width="19" height="3" rx="1.5"/>' },
  tray: { also: ["an in-tray", "done", "a filing tray"], tint: "#8e929c", svg:
    '<path class="d-t3" d="M12 30l5-15h30l5 15z"/><rect class="d-w" x="19" y="19" width="26" height="14" rx="1"/><rect class="d-w2" x="23" y="23" width="14" height="2.5" rx="1.2"/>' +
    '<path class="d-t" d="M6 30h16l2.5 6h15l2.5-6h16v20q0 4-4 4h-44q-4 0-4-4z"/><rect class="d-t2" x="6" y="48" width="52" height="6" rx="3"/>' },
  gone: { also: ["freed memory", "an empty space", "nothing"], tint: "#8e929c", svg:
    [5, 19, 33, 47].map((x) => `<rect class="d-dash" x="${x}" y="18" width="12.5" height="24" rx="2.5"/>`).join("") + '<rect class="d-dash" x="3" y="44" width="58" height="6" rx="2.5"/>' },
};
