// Software engineering: what code is made of, the shapes data takes, and how a team builds and ships it. Same hand as base.ts.
import type { DrawingSet } from "../types";

/** A dot on a line: a commit in a git graph, a node with a white middle. */
const dot = (cx: number, cy: number, c: string, r = 5.5) => `<circle class="${c}" cx="${cx}" cy="${cy}" r="${r}"/><circle class="d-w" cx="${cx}" cy="${cy}" r="${+(r * 0.4).toFixed(1)}"/>`;
/** A ring with a hole that shows what is behind it (outer clockwise, inner the other way). */
const ring = (cx: number, cy: number, r: number, h: number) =>
  `M${cx} ${cy - r}a${r} ${r} 0 1 1 0 ${2 * r}a${r} ${r} 0 1 1 0-${2 * r}zM${cx} ${cy - h}a${h} ${h} 0 1 0 0 ${2 * h}a${h} ${h} 0 1 0 0-${2 * h}z`;
/** A zero: an upright oval ring. */
const zero = (cx: number, cy: number) => `M${cx} ${cy - 7}a5 7 0 1 1 0 14a5 7 0 1 1 0-14zM${cx} ${cy - 4.2}a2.2 4.2 0 1 0 0 8.4a2.2 4.2 0 1 0 0-8.4z`;
/** A digit 0-4 in strokes, 3 wide and 5 tall, from its top left corner. */
const digit = (x: number, y: number, n: number) => `M${x} ${y}` + ["h3v5h-3z", "m1.5 0v5", "h3v2.5h-3v2.5h3", "h3v5h-3m0-2.5h3", "v2.5h3m0-2.5v5"][n];
/** A stadium-shaped chain link with a slot through it. */
const link = (cx: number, w: number, h: number, iw: number, ih: number) => {
  const r = h / 2, q = ih / 2;
  return `M${cx - w / 2 + r} ${32 - r}h${w - h}a${r} ${r} 0 0 1 0 ${h}h-${w - h}a${r} ${r} 0 0 1 0-${h}zM${cx - iw / 2 + q} ${32 - q}a${q} ${q} 0 0 0 0 ${ih}h${iw - ih}a${q} ${q} 0 0 0 0-${ih}z`;
};
/** A nesting doll standing at (x, 56), drawn at scale s. */
const doll = (x: number, s: number, flower: string) =>
  `<g transform="translate(${x} 56) scale(${s})"><g class="d-t"><ellipse cy="-16" rx="13" ry="16"/><circle cy="-35" r="10"/></g>` +
  `<circle class="d-sk" cy="-34" r="6.5"/><path class="d-hr" d="M-6.4-35.5q1-5 6.4-5t6.4 5q-3-2.5-6.4-2.5t-6.4 2.5z"/><g class="d-ink"><circle cx="-2.4" cy="-33.5" r="1"/><circle cx="2.4" cy="-33.5" r="1"/></g>` +
  `<ellipse class="d-w" cy="-15" rx="7" ry="8"/><circle class="${flower}" cy="-15" r="3.5"/></g>`;

export const CODE: DrawingSet = {
  code: { also: ["source code", "a code file", "a script", "a program file", "lines of code", "the source"], tint: "#5f86b3", svg:
    '<ellipse class="d-sh" cx="31" cy="58.5" rx="21" ry="2"/><path class="d-w" d="M12 6h29l12 12v36q0 3-3 3h-38q-3 0-3-3v-45q0-3 3-3z"/><path class="d-t" d="M41 6l12 12h-9q-3 0-3-3z"/>' +
    '<path class="d-line thick tint" d="M23.5 21.5l-9 9.5 9 9.5M38.5 21.5l9 9.5-9 9.5M34 18.5l-6 25"/><path class="d-t" d="M9 47h44v7q0 3-3 3h-38q-3 0-3-3z"/>' },
  terminal: { also: ["the command line", "a shell prompt", "a console", "a command prompt", "the cli", "bash"], tint: "#4b4f58", svg:
    '<ellipse class="d-sh" cx="32" cy="58.5" rx="26" ry="2"/><rect class="d-t" x="4" y="8" width="56" height="48" rx="5"/><rect class="d-dk2" x="8" y="17" width="48" height="35" rx="2"/>' +
    '<circle class="d-pk" cx="10.5" cy="12.5" r="1.8"/><circle class="d-y" cx="16" cy="12.5" r="1.8"/><circle class="d-gr" cx="21.5" cy="12.5" r="1.8"/>' +
    '<path class="d-gr" d="M14 26.5l3-3 10.5 10.5-10.5 10.5-3-3 7.5-7.5z"/><rect class="d-gr" x="30" y="40.5" width="14" height="4" rx="1"/>' },
  function: { also: ["a method", "a procedure", "a routine", "inputs in, output out", "a machine that makes things", "a subroutine"], tint: "#63c2a2", svg:
    '<ellipse class="d-sh" cx="32" cy="58.5" rx="27" ry="2"/><path class="d-w2" d="M13 9h30l-10 11v5h-10v-5z"/><circle class="d-pk" cx="22" cy="9" r="3.6"/><rect class="d-bl" x="29" y="4.5" width="7" height="7" rx="1.5"/>' +
    '<rect class="d-t" x="5" y="24" width="44" height="33" rx="4"/><rect class="d-t3" x="5" y="24" width="44" height="5" rx="2.5"/><rect class="d-t2" x="10" y="34" width="22" height="16" rx="2"/>' +
    '<path class="d-w" d="M13.5 40.5h8v-3.5l6 5-6 5v-3.5h-8z"/><circle class="d-y" cx="40" cy="37" r="2.6"/><circle class="d-gr" cx="40" cy="45" r="2.6"/>' +
    '<path class="d-t2" d="M49 37h6q3 0 3 3v7h-9z"/><circle class="d-y" cx="55.5" cy="53" r="4.5"/><circle class="d-w" cx="54" cy="51.5" r="1.3"/>' },
  variable: { also: ["a named value", "a labelled jar", "a value with a name", "a let", "a const", "a jar"], tint: "#e07f73", svg:
    '<ellipse class="d-sh" cx="32" cy="58.5" rx="18" ry="2"/><path class="d-sky" d="M18 17h28q5 0 5 5v30q0 5-5 5h-28q-5 0-5-5v-30q0-5 5-5z"/><rect class="d-w" x="16" y="36" width="3" height="15" rx="1.5" opacity=".8"/>' +
    '<circle class="d-y" cx="33" cy="46" r="7.5"/><circle class="d-w" cx="30.5" cy="43.5" r="2"/>' +
    '<rect class="d-t" x="16" y="6" width="32" height="10" rx="2.5"/><rect class="d-t3" x="16" y="6" width="32" height="3.5" rx="1.7"/><rect class="d-t2" x="16" y="14" width="32" height="3.5" rx="1"/>' +
    '<rect class="d-w" x="19" y="22" width="26" height="12" rx="2"/><rect class="d-t" x="23" y="26.5" width="18" height="3.5" rx="1.7"/>' },
  array: { also: ["a list", "a row of lockers", "a row of cubbies", "numbered slots", "an index", "a vector"], tint: "#5f86b3", svg:
    '<ellipse class="d-sh" cx="32" cy="56" rx="28" ry="2"/><rect class="d-t" x="3" y="15" width="58" height="38" rx="4"/><rect class="d-t3" x="3" y="15" width="58" height="4.5" rx="2.2"/>' +
    ["d-pk", "d-y", "d-gr", "d-bl", "d-pu"].map((c, i) => { const x = 10.6 + i * 10.7; return `<rect class="d-t2" x="${+(x - 4.6).toFixed(1)}" y="22" width="9.2" height="27" rx="1.5"/><rect class="d-w" x="${+(x - 3.5).toFixed(1)}" y="24.5" width="7" height="8.5" rx="1.2"/><circle class="${c}" cx="${x}" cy="42.5" r="3.6"/>`; }).join("") +
    `<path class="d-line thin" d="${[0, 1, 2, 3, 4].map((n) => digit(+(9.1 + n * 10.7).toFixed(1), 26.2, n)).join("")}"/>` },
  linkedlist: { also: ["a linked list", "a chain of clues", "a treasure hunt", "nodes and pointers", "each one points to the next", "a trail"], tint: "#b79cf0", svg:
    '<ellipse class="d-sh" cx="51" cy="59.5" rx="11" ry="1.8"/>' +
    [[3, 4, "d-pk"], [22, 24, "d-y"], [41, 44, "d-gr"]].map(([x, y, c], i) => `<rect class="d-t" x="${x}" y="${y}" width="20" height="13" rx="2.5"/><path class="d-t2" d="M${+x + 13} ${y}h4.5q2.5 0 2.5 2.5v8q0 2.5-2.5 2.5h-4.5z"/><circle class="${c}" cx="${+x + 6.5}" cy="${+y + 6.5}" r="3.6"/><circle class="${i < 2 ? "d-w" : "d-dk2"}" cx="${+x + 16.5}" cy="${+y + 6.5}" r="2"/>`).join("") +
    '<path class="d-line thick tint" d="M19.5 10.5h8v8M38.5 30.5h8v8"/><path class="d-t" d="M23.5 18h8l-4 5.5zM42.5 38h8l-4 5.5z"/>' },
  binarytree: { also: ["a binary tree", "a hierarchy", "a tree of nodes", "a parent and children", "an org chart", "a decision tree"], tint: "#63c2a2", svg:
    '<path class="d-line thick tint" d="M32 12L18 31M32 12l14 19M18 31l-8 20M18 31l7 20M46 31l-7 20M46 31l8 20"/>' +
    '<circle class="d-t2" cx="32" cy="12" r="8"/><circle class="d-t3" cx="32" cy="12" r="3.2"/><circle class="d-t" cx="18" cy="31" r="6.5"/><circle class="d-t" cx="46" cy="31" r="6.5"/>' +
    [10, 25, 39, 54].map((x) => `<circle class="d-t3" cx="${x}" cy="51" r="5.5"/>`).join("") },
  graph: { also: ["a network of friends", "a map of routes", "nodes and edges", "a web of links", "a social network", "a network map"], tint: "#7b7fb5", svg:
    '<path class="d-line thick tint" d="M12 16L34 8l21 12-7 28-31 2zM31 31L12 16M31 31L34 8M31 31l24-11M31 31L17 50"/>' +
    '<circle class="d-pk" cx="12" cy="16" r="5.5"/><circle class="d-y" cx="34" cy="8" r="5"/><circle class="d-gr" cx="55" cy="20" r="5.5"/><circle class="d-bl" cx="48" cy="48" r="6"/><circle class="d-pu" cx="17" cy="50" r="5.5"/>' +
    '<circle class="d-t2" cx="31" cy="31" r="7.5"/><circle class="d-t3" cx="31" cy="31" r="3"/>' },
  hashmap: { also: ["a hash map", "a key-value store", "a coat check", "a lookup table", "a wall of lockers", "keys and values"], tint: "#6fa3b8", svg:
    '<ellipse class="d-sh" cx="32" cy="59" rx="27" ry="2"/><rect class="d-t2" x="5" y="5" width="54" height="52" rx="3"/>' +
    '<rect class="d-t" x="8" y="8" width="48.1" height="46.9" rx="1.5"/><path class="d-t2" d="M22.7 8h2v47h-2zM39.4 8h2v47h-2zM8 22.3h48v2h-48zM8 38.6h48v2h-48z"/>' +
    '<rect class="d-dk2" x="41.4" y="40.6" width="14.7" height="14.3"/><circle class="d-y" cx="48.7" cy="48.4" r="4"/><path class="d-t3" d="M56.1 40.6l5 2v10.3l-5 2z"/>' +
    `<path class="d-w" d="${[0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => (r === 2 && c === 2 ? "" : `M${+(10.5 + c * 16.7).toFixed(1)} ${+(10.5 + r * 16.3).toFixed(1)}h9.7v4h-9.7z`))).join("")}"/>` +
    `<path class="d-t2" d="${[0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => (r === 2 && c === 2 ? "" : `M${+(18.2 + c * 16.7).toFixed(1)} ${+(16.5 + r * 16.3).toFixed(1)}h2v3.5h-2z`))).join("")}"/>` },
  binary: { also: ["bits", "ones and zeros", "binary code", "base two", "machine code", "bytes"], tint: "#4e9f63", svg:
    [[1, 0, 1, 1], [0, 1, 1, 0], [1, 1, 0, 1]].map((row, r) => row.map((b, c) => { const x = 11 + c * 14, y = 12 + r * 20; return b ? `<rect class="d-t" x="${x - 2.3}" y="${y - 7}" width="4.6" height="14" rx="2"/>` : `<path class="d-t2" d="${zero(x, y)}"/>`; }).join("")).join("") },
  json: { also: ["a json file", "a config file", "an object", "settings data", "key and value pairs", "curly braces"], tint: "#f0a94b", svg:
    '<path class="d-line thick tint" d="M19 7q-6 0-6 6v11q0 8-7 8 7 0 7 8v11q0 6 6 6M45 7q6 0 6 6v11q0 8 7 8-7 0-7 8v11q0 6-6 6"/>' +
    [[17, 9, "d-y"], [26.5, 6, "d-gr"], [36, 9, "d-pk"], [45.5, 5, "d-y"]].map(([y, w, c]) => `<rect class="d-bl" x="21" y="${y}" width="9" height="4.5" rx="2.2"/><rect class="${c}" x="33" y="${y}" width="${w}" height="4.5" rx="2.2"/>`).join("") },
  blueprint: { also: ["a class definition", "a template", "a cookie cutter", "a plan", "a design", "an architect's drawing"], tint: "#5f86b3", svg:
    '<ellipse class="d-sh" cx="32" cy="58.5" rx="26" ry="2"/><path class="d-t" d="M8.5 6h47q2.5 0 2.5 2.5v35.5l-12 12h-35.5q-2.5 0-2.5-2.5v-45q0-2.5 2.5-2.5z"/>' +
    '<path class="d-line thin2" d="M6 18h52M6 30h52M6 42h40M19 6v50M32 6v50M45 6v50" opacity=".3"/><path class="d-t3" d="M46 56v-9q0-3 3-3h9z"/>' +
    '<path class="d-line white" d="M17 29l14-12 14 12v18h-28zM27.5 47v-9h7v9M20.5 31.5h5v5h-5zM36.5 31.5h5v5h-5z"/>' },
  loop: { also: ["a repeat", "iteration", "a for loop", "going round again", "a cycle", "round and round"], tint: "#b79cf0", svg:
    '<path class="d-t" d="M45.5 16.9A21 21 0 1 1 18.5 16.9L23.6 23A13 13 0 1 0 40.4 23z"/><path class="d-t" d="M26.9 26.9L15.3 13.1 28.8 13.6z"/>' +
    [[49, 33], [40.5, 47.7], [23.5, 47.7], [15, 33]].map(([x, y]) => `<circle class="d-w" cx="${x}" cy="${y}" r="1.8"/>`).join("") },
  branch: { also: ["a git branch", "a branch of work", "a feature branch", "a side line", "splitting off", "a new line of work"], tint: "#f0a94b", svg:
    '<path class="d-line thick net" d="M5 42h54"/><path class="d-line thick tint" d="M15 42q0-20 20-20h24"/>' + dot(15, 42, "d-bl2") + dot(33, 42, "d-bl2") + dot(51, 42, "d-bl2") + dot(39, 22, "d-t") + dot(53, 22, "d-t") },
  commit: { also: ["a git commit", "a save point", "a saved version", "a snapshot in history", "saving your work", "a change"], tint: "#5f86b3", svg:
    '<path class="d-line thick tint" d="M4 34h56"/><circle class="d-t2" cx="32" cy="35.5" r="14"/><circle class="d-t" cx="32" cy="34" r="14"/><circle class="d-w" cx="32" cy="34" r="6.5"/>' +
    '<circle class="d-gr2" cx="45" cy="20" r="7.5"/><path class="d-line white" d="M41.5 20l2.5 2.5 4.5-5"/>' },
  merge: { also: ["a git merge", "two roads joining", "joining together", "combining work", "coming together", "a join"], tint: "#b79cf0", svg:
    '<path class="d-line thick net" d="M5 16h9c12 0 14 16 26 16"/><path class="d-line thick tint" d="M5 48h9c12 0 14-16 26-16h19"/>' + dot(11, 16, "d-bl2") + dot(11, 48, "d-t") + dot(40, 32, "d-t", 7) + dot(54, 32, "d-t") },
  pullrequest: { also: ["a pull request", "a code review", "a merge request", "asking to merge", "a pr", "a review"], tint: "#63c2a2", svg:
    '<path class="d-line thick net" d="M16 13v38"/><path class="d-line thick tint" d="M44 51V22q0-8-8-8h-5"/><path class="d-t" d="M24 14l8-6.5v13z"/>' + dot(16, 13, "d-bl2") + dot(16, 51, "d-bl2") + dot(44, 51, "d-t") +
    '<path class="d-gr2" d="M47 3h11q3 0 3 3v8q0 3-3 3h-7l-4.5 3.5v-3.5q-2.5 0-2.5-3v-8q0-3 3-3z"/><path class="d-line white" d="M48.5 10l2.5 2.5 4.5-4.5"/>' },
  conveyor: { also: ["a conveyor belt", "a build pipeline", "a ci pipeline", "ci/cd", "an assembly line", "a production line", "continuous delivery"], tint: "#f0a94b", svg:
    '<ellipse class="d-sh" cx="32" cy="59" rx="28" ry="2"/><rect class="d-w2" x="11" y="46" width="4" height="12"/><rect class="d-w2" x="49" y="46" width="4" height="12"/><rect class="d-dk" x="3" y="36" width="58" height="12" rx="6"/>' +
    [9, 20.5, 32, 43.5, 55].map((x) => `<circle class="d-w2" cx="${x}" cy="42" r="3.6"/><circle class="d-dk2" cx="${x}" cy="42" r="1.3"/>`).join("") +
    [[6, 22, 14], [25, 19, 17], [44, 22, 14]].map(([x, y, h]) => `<rect class="d-t" x="${x}" y="${y}" width="14" height="${h}" rx="1.5"/><rect class="d-t2" x="${x}" y="${y}" width="14" height="3.5" rx="1.5"/><rect class="d-t3" x="${x + 5.5}" y="${y}" width="3" height="${h}"/>`).join("") +
    '<path class="d-line thick tint" d="M22 9h20m-5-4.5l5 4.5-5 4.5"/>' },
  checklist: { also: ["a to-do list", "tests passing", "a clipboard", "all ticked off", "test results", "a task list"], tint: "#c9935b", svg:
    '<ellipse class="d-sh" cx="32" cy="58.5" rx="20" ry="2"/><rect class="d-t" x="11" y="7" width="42" height="51" rx="4"/><rect class="d-w" x="15" y="13" width="34" height="41" rx="2"/><rect class="d-w2" x="23" y="4" width="18" height="9" rx="2.5"/><rect class="d-dk" x="28" y="6" width="8" height="2.5" rx="1.2"/>' +
    [19, 30, 41].map((y) => `<rect class="d-gr2" x="19" y="${y}" width="8" height="8" rx="2"/><path class="d-line white" d="M20.8 ${y + 4.2}l2 2 3.4-3.8"/><rect class="d-w2" x="30" y="${y + 2.5}" width="15" height="3" rx="1.5"/>`).join("") },
  package: { also: ["a software package", "a dependency you install", "an npm module", "a bundle", "a crate", "a third-party module"], tint: "#c58d57", svg:
    '<ellipse class="d-sh" cx="32" cy="58.5" rx="26" ry="2"/><path class="d-t3" d="M6 26l6-12h40l6 12z"/><rect class="d-t" x="6" y="26" width="52" height="31" rx="2"/><rect class="d-t2" x="6" y="26" width="52" height="3.5"/>' +
    '<path class="d-y" d="M29 14h6l1.5 12h-9z"/><rect class="d-y" x="27.5" y="26" width="9" height="9"/><path class="d-y2" d="M27.5 35l2.2-2 2.3 2 2.3-2 2.2 2z"/>' +
    '<path class="d-w" d="M32 38l6.5 3.5-6.5 3.5-6.5-3.5z"/><path class="d-w2" d="M25.5 41.5l6.5 3.5v7.5l-6.5-3.5z"/><path class="d-w3" d="M38.5 41.5l-6.5 3.5v7.5l6.5-3.5z"/>' },
  chain: { also: ["a dependency", "linked together", "chain links", "a weak link", "connected in a row", "a sequence"], tint: "#8e929c", svg:
    '<g transform="rotate(-35 32 32)"><rect class="d-t2" x="19" y="28.5" width="26" height="7" rx="3.5"/><rect class="d-t3" x="22" y="29.5" width="20" height="1.8" rx=".9"/>' +
    `<path class="d-t" d="${link(14.5, 27, 16, 15, 5)}${link(49.5, 27, 16, 15, 5)}"/><rect class="d-t3" x="8" y="25.5" width="13" height="2" rx="1"/><rect class="d-t3" x="43" y="25.5" width="13" height="2" rx="1"/></g>` },
  tag: { also: ["a version", "a release tag", "a label", "a price tag", "a version number", "v1.0"], tint: "#f3c14b", svg:
    '<path class="d-line grey" d="M21.4 21.4c-6-2-9-6-10-12-.5-3 2-5.5 5-4.5"/>' +
    `<g transform="rotate(45 32 32)"><path class="d-t" d="M18 21h34q4 0 4 4v14q0 4-4 4h-34l-11-11zM17 29a3 3 0 1 0 0 6a3 3 0 1 0 0-6z"/><path class="d-t3" d="${ring(17, 32, 4.6, 3)}"/>` +
    '<rect class="d-t2" x="26" y="26.5" width="23" height="4" rx="2"/><rect class="d-t2" x="26" y="33.5" width="15" height="4" rx="2"/></g>' },
  fork: { also: ["a fork in the path", "if or else", "a choice of two ways", "forking a project", "a split", "a y-junction"], tint: "#70778a", svg:
    '<path class="d-t" d="M24 60V40L6 8h13l13 21 13-21h13L40 40v20z"/><path class="d-t2" d="M24 60V40l-1.3-2.3h18.6L40 40v20z" opacity=".5"/>' +
    '<rect class="d-y" x="30.8" y="44" width="2.4" height="6" rx="1"/><rect class="d-y" x="30.8" y="53" width="2.4" height="6" rx="1"/>' +
    '<rect class="d-y" x="15.7" y="12.5" width="2.4" height="6" rx="1" transform="rotate(-30 16.9 15.5)"/><rect class="d-y" x="20.7" y="21.3" width="2.4" height="6" rx="1" transform="rotate(-30 21.9 24.3)"/>' +
    '<rect class="d-y" x="45.9" y="12.5" width="2.4" height="6" rx="1" transform="rotate(30 47.1 15.5)"/><rect class="d-y" x="40.9" y="21.3" width="2.4" height="6" rx="1" transform="rotate(30 42.1 24.3)"/>' },
  thread: { also: ["a spool of thread", "a cotton reel", "a strand", "running side by side", "a thread of work", "a yarn"], tint: "#e07f73", svg:
    '<ellipse class="d-sh" cx="34" cy="58.5" rx="21" ry="2"/><rect class="d-t" x="18" y="13" width="28" height="38"/><path class="d-t2" d="M18 19h28v2h-28zM18 26h28v2h-28zM18 33h28v2h-28zM18 40h28v2h-28zM18 47h28v2h-28z"/><rect class="d-t3" x="21" y="13" width="3.5" height="38"/>' +
    '<path class="d-line thick tint" d="M46 30c9 0 12 6 10 12s-6 8-3 14"/><rect class="d-wood" x="14" y="6" width="36" height="8" rx="2.5"/><rect class="d-wood" x="14" y="50" width="36" height="8" rx="2.5"/><rect class="d-y2" x="17" y="7.5" width="30" height="2" rx="1" opacity=".6"/>' },
  dolls: { also: ["nesting dolls", "russian dolls", "matryoshka", "recursion", "a thing inside itself", "smaller and smaller"], tint: "#d9534f", svg:
    '<ellipse class="d-sh" cx="33" cy="57" rx="29" ry="2"/>' + doll(16, 1, "d-y") + doll(38.5, 0.75, "d-pk") + doll(55, 0.52, "d-gr") },
  flowchart: { also: ["a flow chart", "an algorithm diagram", "steps and decisions", "a process map", "a decision diagram", "the steps of a program"], tint: "#5f86b3", svg:
    '<path class="d-line thick tint" d="M29 15v3M29 33v3M44 49h9v-22h-4"/><path class="d-t" d="M25.5 17.5h7l-3.5 4zM25.5 35.5h7l-3.5 4zM48.5 23.5v7l-4.5-3.5z"/>' +
    '<ellipse class="d-gr" cx="29" cy="9" rx="13" ry="6"/><rect class="d-t" x="14" y="21" width="30" height="12" rx="2"/><rect class="d-w" x="20" y="25.5" width="18" height="3" rx="1.5"/><path class="d-y" d="M29 39l15 10-15 10-15-10z"/><path class="d-y2" d="M29 59l15-10h-30z" opacity=".5"/>' },
};
